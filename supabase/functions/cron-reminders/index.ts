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
 *   SUPABASE_URL              — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 *
 * Deploy:
 *   npx supabase functions deploy cron-reminders
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

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

// ── Types ─────────────────────────────────────────────────────────────────────
interface BusinessRow {
  id:       string
  name:     string
  timezone: string | null
  settings: Record<string, unknown> | null
}

interface AppointmentWithClient {
  id:         string
  start_at:   string
  service_id: string
  services:   { name: string } | null
  clients:    { name: string; phone: string | null } | null
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
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Admin client ────────────────────────────────────────────────────────
  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Get all businesses ──────────────────────────────────────────────────
  const { data: businesses, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name, timezone, settings')

  if (bizErr || !businesses) {
    console.error('[cron-reminders] businesses fetch error:', bizErr?.message)
    return json({ error: bizErr?.message ?? 'No businesses found' }, 500)
  }

  const results = { businesses_checked: 0, businesses_at_8pm: 0, wa_sent: 0, wa_failed: 0, push_sent: 0 }

  for (const biz of businesses as BusinessRow[]) {
    results.businesses_checked++
    const timezone = biz.timezone ?? 'UTC'

    // ── Skip businesses that are NOT at 8 PM local ───────────────────────
    if (!is8PMInTimezone(timezone)) {
      continue
    }

    results.businesses_at_8pm++
    console.log(`[cron-reminders] Business "${biz.name}" is at 8 PM (${timezone}). Processing...`)

    // ── Skip if business explicitly disabled WhatsApp notifications ────
    const settings = biz.settings as Record<string, unknown> | null
    const whatsappEnabled = (settings?.notifications as Record<string, unknown>)?.whatsapp !== false

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
      console.error(`[cron-reminders] appointments fetch error for ${biz.name}:`, aptErr.message)
      continue
    }

    const apts = (appointments ?? []) as unknown as AppointmentWithClient[]

    if (apts.length === 0) {
      console.log(`[cron-reminders] No appointments tomorrow for "${biz.name}". Skipping.`)
      continue
    }

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

      const waResults = await Promise.allSettled(
        sendableApts.map(async (apt) => {
          const client = apt.clients!
          const startDate = new Date(apt.start_at)
          const date = startDate.toLocaleDateString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })
          const time = startDate.toLocaleTimeString('es-CO', {
            hour: '2-digit', minute: '2-digit',
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
          }, { onConflict: 'appointment_id' }).catch(() => null)

          return data.success === true
        })
      )

      for (const result of waResults) {
        if (result.status === 'fulfilled' && result.value) {
          results.wa_sent++
        } else {
          results.wa_failed++
        }
      }
    }

    // ── 2. Send consolidated push to business owner ───────────────────────
    const MAX_LISTED = 5
    const listed = apts.slice(0, MAX_LISTED).map(apt => {
      const clientName = apt.clients?.name ?? 'Cliente'
      const serviceName = apt.services?.name ?? 'Servicio'
      const time = new Date(apt.start_at).toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit',
      })
      return `${time} · ${clientName} — ${serviceName}`
    })

    const overflow = apts.length > MAX_LISTED ? `\n+${apts.length - MAX_LISTED} más` : ''
    const pushBody = listed.join('\n') + overflow

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
      console.error(`[cron-reminders] push error for ${biz.name}:`, err)
    }
  }

  console.log('[cron-reminders] Run complete:', JSON.stringify(results))
  return json({ ok: true, ...results })
})
