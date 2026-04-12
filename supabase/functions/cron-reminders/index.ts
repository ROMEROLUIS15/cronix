/**
 * Supabase Edge Function — cron-reminders
 *
 * Runs every hour via pg_cron. For each business whose local time is 8 PM,
 * it sends:
 *   1. WhatsApp reminders to clients with appointments TOMORROW
 *   2. A consolidated push notification to the business owner summarizing
 *      all appointments scheduled for tomorrow
 *
 * Security: x-internal-secret: <CRON_SECRET> (server-to-server only)
 *
 * Required Supabase Secrets:
 *   CRON_SECRET               — shared with pg_cron trigger
 *   SENTRY_DSN                — optional, enables error tracking
 *   SUPABASE_URL              — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 *
 * Deploy:
 *   npx supabase functions deploy cron-reminders
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'
import { initSentry, captureException, addBreadcrumb,
         setSentryTag, flushSentry }                    from '../_shared/sentry.ts'
import type { BusinessRow, AppointmentWithClient }      from './types.ts'

initSentry('cron-reminders')

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Notification helper ───────────────────────────────────────────────────────
function buildReminderNotification(
  _businessId:  string,
  appointments: AppointmentWithClient[]
): { title: string; content: string; type: string; metadata: Record<string, unknown> } {
  const MAX_LISTED = 5
  const listed = appointments.slice(0, MAX_LISTED).map(apt => {
    const clientName  = apt.clients?.name  ?? 'Cliente'
    const serviceName = apt.services?.name ?? 'Servicio'
    const time = new Date(apt.start_at).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit',
    })
    return `${time} · ${clientName} — ${serviceName}`
  })

  const overflow = appointments.length > MAX_LISTED ? `\n+${appointments.length - MAX_LISTED} más` : ''

  return {
    title:    `📋 ${appointments.length} recordatorio${appointments.length > 1 ? 's' : ''} enviado${appointments.length > 1 ? 's' : ''}`,
    content:  listed.join('\n') + overflow,
    type:     'info',
    metadata: { event: 'reminder.sent', totalAppointments: appointments.length },
  }
}

// ── Helper: Check if it's 8 PM in a given timezone ───────────────────────────
function is8PMInTimezone(timezone: string): boolean {
  const now = new Date()
  const localHour = parseInt(
    now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
  )
  return localHour === 20 // 8 PM = 20:00
}

// ── Helper: Get tomorrow's date range in a timezone ──────────────────────────
function getTomorrowRange(timezone: string): { start: string; end: string } {
  const now = new Date()

  // Get "today" in the business timezone
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
  const localDate = new Date(localDateStr + 'T00:00:00Z')

  // Tomorrow = localDate + 1 day
  const tomorrow = new Date(localDate.getTime() + 24 * 60 * 60 * 1000)
  const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)

  return {
    start: tomorrow.toISOString(),
    end:   dayAfter.toISOString(),
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const cronSecret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('authorization')

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    await flushSentry()
    return json({ error: 'Unauthorized' }, 401)
  }

  addBreadcrumb('Cron auth verified', 'security')

  // ── Admin client ────────────────────────────────────────────────────────
  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Get businesses at 8 PM local time ─────────────────────────────────────
  // OPTIMIZATION: Push timezone filter into DB instead of fetching ALL businesses.
  // Only returns businesses where EXTRACT(HOUR FROM NOW() AT TIME ZONE tz) = 20
  const { data: businesses, error: bizErr } = await supabase.rpc(
    'fn_get_businesses_at_hour',
    { p_hour: 20 }
  )

  if (bizErr || !businesses) {
    captureException(bizErr ?? new Error('No businesses returned'), {
      stage: 'fetch_businesses',
    })
    await flushSentry()
    return json({ error: bizErr?.message ?? 'No businesses found' }, 500)
  }

  addBreadcrumb('Businesses fetched', 'database', 'info', { count: businesses.length })

  const results = {
    businesses_checked: 0,
    businesses_at_8pm:  0,
    wa_sent:            0,
    wa_failed:          0,
    push_sent:          0,
  }

  for (const biz of businesses as BusinessRow[]) {
    results.businesses_checked++
    const timezone = biz.timezone ?? 'UTC'

    // No longer need is8PMInTimezone check — DB already filtered

    // Scope all Sentry events in this iteration to the current business
    setSentryTag('business_id',   biz.id)
    setSentryTag('business_name', biz.name)
    addBreadcrumb(`Processing business at 8 PM: ${biz.name}`, 'cron', 'info', {
      business_id: biz.id,
      timezone,
    })

    // ── Skip if business explicitly disabled WhatsApp notifications ────
    const settings = biz.settings as Record<string, unknown> | null
    const whatsappEnabled =
      (settings?.notifications as Record<string, unknown>)?.whatsapp !== false

    // ── Get tomorrow's appointments ───────────────────────────────────────
    const { start, end } = getTomorrowRange(timezone)

    const { data: appointments, error: aptErr } = await supabase
      .from('appointments')
      .select(`
        id,
        start_at,
        service_id,
        services ( name ),
        clients ( name, phone )
      `)
      .eq('business_id', biz.id)
      .gte('start_at', start)
      .lt('start_at', end)
      .not('status', 'in', '("cancelled","no_show")')
      .order('start_at', { ascending: true })

    if (aptErr) {
      captureException(aptErr, {
        stage:       'fetch_appointments',
        business_id: biz.id,
      })
      continue
    }

    const apts = (appointments ?? []) as unknown as AppointmentWithClient[]

    if (apts.length === 0) {
      continue
    }

    addBreadcrumb('Appointments fetched for tomorrow', 'database', 'info', {
      business_id: biz.id,
      count:       apts.length,
    })

    // ── Get cancelled reminders (appointments where owner toggled "Omitir") ──
    const aptIds = apts.map(a => a.id)
    const { data: cancelledReminders } = await supabase
      .from('appointment_reminders')
      .select('appointment_id')
      .in('appointment_id', aptIds)
      .eq('status', 'cancelled')

    const skippedAptIds = new Set((cancelledReminders ?? []).map(r => r.appointment_id))

    // ── 1. Send WhatsApp reminders to each client (parallel) ───────────
    if (whatsappEnabled) {
      const whatsappUrl = `${supabaseUrl}/functions/v1/whatsapp-service`

      // Skip appointments where the owner opted out of the reminder
      const sendableApts = apts.filter(apt => apt.clients?.phone && !skippedAptIds.has(apt.id))

      addBreadcrumb('Sending WhatsApp reminders', 'whatsapp', 'info', {
        business_id: biz.id,
        count:       sendableApts.length,
      })

      const waResults = await Promise.allSettled(
        sendableApts.map(async (apt) => {
          const client    = apt.clients!
          const startDate = new Date(apt.start_at)
          const date = startDate.toLocaleDateString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
          })
          const time = startDate.toLocaleTimeString('es-CO', {
            hour: '2-digit', minute: '2-digit', timeZone: timezone,
          })

          const res = await fetch(whatsappUrl, {
            method:  'POST',
            headers: {
              'Content-Type':      'application/json',
              'x-internal-secret': cronSecret,
            },
            body: JSON.stringify({
              to:           client.phone,
              clientName:   client.name,
              businessName: biz.name,
              date,
              time,
            }),
          })

          const data = await res.json().catch(() => ({ success: false })) as {
            success?: boolean
          }

          // Track sent status in appointment_reminders table
          await supabase.from('appointment_reminders').upsert({
            appointment_id: apt.id,
            business_id:    biz.id,
            remind_at:      new Date().toISOString(),
            status:         data.success === true ? 'sent' : 'failed',
            channel:        'whatsapp',
            sent_at:        data.success === true ? new Date().toISOString() : null,
            error_message:  data.success === true ? null : 'WhatsApp delivery failed',
          }, { onConflict: 'appointment_id' })

          return data.success === true
        })
      )

      const failedAppointments: AppointmentWithClient[] = []
      for (let i = 0; i < waResults.length; i++) {
        const result = waResults[i]!
        if (result.status === 'fulfilled' && result.value) {
          results.wa_sent++
        } else {
          results.wa_failed++
          failedAppointments.push(sendableApts[i]!)
          // Capture individual delivery failures as non-fatal exceptions
          if (result.status === 'rejected') {
            captureException(result.reason, {
              stage:       'whatsapp_send',
              business_id: biz.id,
            })
          }
        }
      }

      // Create notification for WhatsApp failures
      if (failedAppointments.length > 0) {
        try {
          const failureNotif = failedAppointments.length === 1
            ? {
                title: '❌ Fallo al enviar recordatorio',
                content: `No se pudo enviar recordatorio a ${failedAppointments[0]!.clients?.name || 'cliente'}`,
                type: 'error',
                metadata: { event: 'whatsapp.failed', failureCount: 1 },
              }
            : {
                title: `❌ ${failedAppointments.length} recordatorios no enviados`,
                content: `No se pudieron entregar ${failedAppointments.length} recordatorios por WhatsApp. Verifica la configuración.`,
                type: 'error',
                metadata: { event: 'whatsapp.multiple_failed', failureCount: failedAppointments.length },
              }

          await supabase.from('notifications').insert([
            {
              business_id: biz.id,
              title: failureNotif.title,
              content: failureNotif.content,
              type: failureNotif.type,
              metadata: failureNotif.metadata,
              is_read: false,
            },
          ])
        } catch (err) {
          captureException(err, {
            stage: 'create_whatsapp_failure_notification',
            business_id: biz.id,
          })
        }
      }
    }

    // ── 2. Create in-app notification ──────────────────────────────────────
    const notifPayload = buildReminderNotification(biz.id, apts)
    try {
      await supabase.from('notifications').insert([
        {
          business_id: biz.id,
          title:       notifPayload.title,
          content:     notifPayload.content,
          type:        notifPayload.type,
          metadata:    notifPayload.metadata,
          is_read:     false,
        },
      ])
    } catch (err) {
      captureException(err, {
        stage:       'create_in_app_notification',
        business_id: biz.id,
      })
    }

    // ── 3. Send consolidated push to business owner ───────────────────────
    const MAX_LISTED = 5
    const listed = apts.slice(0, MAX_LISTED).map(apt => {
      const clientName  = apt.clients?.name  ?? 'Cliente'
      const serviceName = apt.services?.name ?? 'Servicio'
      const time = new Date(apt.start_at).toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', timeZone: timezone,
      })
      return `${time} · ${clientName} — ${serviceName}`
    })

    const overflow = apts.length > MAX_LISTED ? `\n+${apts.length - MAX_LISTED} más` : ''
    const pushBody  = listed.join('\n') + overflow

    const pushUrl = `${supabaseUrl}/functions/v1/push-notify`

    try {
      await fetch(pushUrl, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': cronSecret,
        },
        body: JSON.stringify({
          business_id: biz.id,
          title:       `📋 ${apts.length} cita${apts.length > 1 ? 's' : ''} para mañana`,
          body:        pushBody,
          url:         '/dashboard',
        }),
      })
      results.push_sent++
    } catch (err) {
      captureException(err, {
        stage:       'push_notify',
        business_id: biz.id,
      })
    }
  }

  // ── Cleanup: Delete notifications older than 30 days ─────────────────────
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 30)

  const { error: cleanupErr, count: cleanedCount } = await supabase
    .from('notifications')
    .delete()
    .lt('created_at', cutoffDate.toISOString())
    .select('id', { count: 'exact' })

  if (cleanupErr) {
    captureException(cleanupErr, { stage: 'cleanup_old_notifications' })
  } else {
    addBreadcrumb('Old notifications cleaned', 'database', 'info', { count: cleanedCount })
  }

  addBreadcrumb('Cron run complete', 'cron', 'info', { ...results })

  await flushSentry()
  return json({ ok: true, ...results, notifications_cleaned: cleanedCount ?? 0 })
})
