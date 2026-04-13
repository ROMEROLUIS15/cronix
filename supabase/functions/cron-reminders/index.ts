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
import { initSentry, captureException, addBreadcrumb,
         setSentryTag, flushSentry }                    from '../_shared/sentry.ts'
import { getBusinessesAt8PM, getTomorrowRange }         from './modules/business-scheduler.ts'
import { getTomorrowAppointments, getCancelledReminders } from './modules/appointment-fetcher.ts'
import { sendWhatsAppReminders }                        from './modules/whatsapp-sender.ts'
import { buildReminderNotification, buildWhatsAppFailureNotification,
         insertNotification, sendPushNotification }     from './modules/notification-builder.ts'
import { cleanupOldNotifications }                      from './modules/cleanup.ts'
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

  // ── Get businesses at 8 PM local time ─────────────────────────────────────
  let businesses: BusinessRow[]
  try {
    businesses = await getBusinessesAt8PM()
  } catch (err) {
    captureException(err, { stage: 'fetch_businesses' })
    await flushSentry()
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }

  addBreadcrumb('Businesses fetched', 'database', 'info', { count: businesses.length })

  const results = {
    businesses_checked: 0,
    businesses_at_8pm:  0,
    wa_sent:            0,
    wa_failed:          0,
    push_sent:          0,
  }

  for (const biz of businesses) {
    results.businesses_checked++
    results.businesses_at_8pm++
    const timezone = biz.timezone ?? 'UTC'

    setSentryTag('business_id',   biz.id)
    setSentryTag('business_name', biz.name)
    addBreadcrumb(`Processing business at 8 PM: ${biz.name}`, 'cron', 'info', {
      business_id: biz.id,
      timezone,
    })

    // ── Get tomorrow's appointments ───────────────────────────────────────
    const { start, end } = getTomorrowRange(timezone)

    let apts: AppointmentWithClient[]
    try {
      apts = await getTomorrowAppointments(biz.id, start, end)
    } catch (err) {
      captureException(err, { stage: 'fetch_appointments', business_id: biz.id })
      continue
    }

    if (apts.length === 0) continue

    addBreadcrumb('Appointments fetched for tomorrow', 'database', 'info', {
      business_id: biz.id,
      count: apts.length,
    })

    // ── Get cancelled reminders ───────────────────────────────────────────
    const aptIds = apts.map(a => a.id)
    const skippedAptIds = await getCancelledReminders(aptIds)

    // ── 1. Send WhatsApp reminders ────────────────────────────────────────
    const waResult = await sendWhatsAppReminders(biz, apts, skippedAptIds, cronSecret)
    results.wa_sent += waResult.sent
    results.wa_failed += waResult.failed

    // Failure notifications
    const failureNotif = buildWhatsAppFailureNotification(waResult.failedAppointments)
    if (failureNotif) {
      try {
        await insertNotification(biz.id, failureNotif)
      } catch (err) {
        captureException(err, { stage: 'create_whatsapp_failure_notification', business_id: biz.id })
      }
    }

    // ── 2. Create in-app notification ─────────────────────────────────────
    const notifPayload = buildReminderNotification(apts)
    try {
      await insertNotification(biz.id, notifPayload)
    } catch (err) {
      captureException(err, { stage: 'create_in_app_notification', business_id: biz.id })
    }

    // ── 3. Send consolidated push to business owner ───────────────────────
    const pushSent = await sendPushNotification(biz, apts, cronSecret)
    if (pushSent) results.push_sent++
  }

  // ── Cleanup: Delete notifications older than 30 days ─────────────────────
  try {
    const cleanedCount = await cleanupOldNotifications()
    addBreadcrumb('Old notifications cleaned', 'database', 'info', { count: cleanedCount })
    results.notifications_cleaned = cleanedCount
  } catch (err) {
    captureException(err, { stage: 'cleanup_old_notifications' })
  }

  addBreadcrumb('Cron run complete', 'cron', 'info', { ...results })

  await flushSentry()
  return json({ ok: true, ...results })
})
