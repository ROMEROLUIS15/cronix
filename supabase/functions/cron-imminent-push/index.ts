/**
 * Supabase Edge Function — cron-imminent-push
 *
 * Runs every 15 minutes via pg_cron. Finds appointments starting in the next
 * 45–75 min window that haven't been "imminent-notified" yet and pushes a
 * single notification to the business owner's installed PWA.
 *
 * Idempotency: inserts a sentinel row in appointment_reminders with
 * channel='push_owner' and status='sent' so re-runs skip the appointment.
 * A partial UNIQUE index on (appointment_id) WHERE channel='push_owner'
 * protects against concurrent cron overlaps at the DB level.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

const SENTINEL_CHANNEL = 'push_owner'

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const now = new Date()
  const windowStart = new Date(now.getTime() + 45 * 60 * 1000).toISOString()
  const windowEnd   = new Date(now.getTime() + 75 * 60 * 1000).toISOString()

  const { data: apts, error } = await supabase
    .from('appointments')
    .select('id, business_id, start_at, clients ( name ), services ( name )')
    .gte('start_at', windowStart)
    .lt('start_at',  windowEnd)
    .not('status', 'in', '("cancelled","no_show")')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const aptList = (apts ?? []) as Array<{
    id: string; business_id: string; start_at: string;
    clients: { name: string } | null; services: { name: string } | null
  }>

  if (aptList.length === 0) {
    return new Response(JSON.stringify({ ok: true, pushed: 0 }), { status: 200 })
  }

  // Filter out appointments that already received an imminent-owner-push.
  const aptIds = aptList.map(a => a.id)
  const { data: alreadySent } = await supabase
    .from('appointment_reminders')
    .select('appointment_id')
    .in('appointment_id', aptIds)
    .eq('channel', SENTINEL_CHANNEL)
    .eq('status', 'sent')

  const skip = new Set((alreadySent ?? []).map(r => r.appointment_id))
  const pending = aptList.filter(a => !skip.has(a.id))

  let pushed = 0
  for (const apt of pending) {
    const clientName  = apt.clients?.name  ?? 'Cliente'
    const serviceName = apt.services?.name ?? 'Servicio'
    const timeStr = new Date(apt.start_at).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    })

    try {
      await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
        body: JSON.stringify({
          business_id: apt.business_id,
          title: '⏰ Cita en 1 hora',
          body:  `${clientName} · ${serviceName} · ${timeStr}`,
          url:   `/dashboard/appointments/${apt.id}`,
          tag:   `imminent-${apt.id}`,
        }),
      })

      // Mark as sent — sentinel row, NOT a reminder for the client.
      await supabase.from('appointment_reminders').insert({
        appointment_id: apt.id,
        business_id:    apt.business_id,
        remind_at:      now.toISOString(),
        minutes_before: 60,
        status:         'sent',
        channel:        SENTINEL_CHANNEL,
        sent_at:        now.toISOString(),
      })

      pushed++
    } catch (err) {
      console.warn('[cron-imminent-push] push failed', apt.id, err)
    }
  }

  return new Response(JSON.stringify({ ok: true, pushed, scanned: aptList.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
