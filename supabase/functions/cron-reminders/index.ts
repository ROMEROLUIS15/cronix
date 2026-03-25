/**
 * Supabase Edge Function — cron-reminders
 *
 * Processes pending WhatsApp appointment reminders.
 * This is the Edge Function equivalent of app/api/cron/send-reminders/route.ts.
 *
 * Security: Authorization: Bearer <CRON_SECRET>
 *
 * Can be triggered by:
 *  - Vercel Cron (update vercel.json path to this function's URL)
 *  - Supabase pg_cron via: SELECT net.http_get(url, headers) or pg_cron + http
 *  - Any HTTP client with the correct Bearer token
 *
 * Required Supabase Secrets:
 *   CRON_SECRET               — shared with Vercel / pg_cron trigger
 *   SUPABASE_URL              — auto-injected by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase runtime
 *
 * Deploy:
 *   npx supabase functions deploy cron-reminders
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

// ── CORS headers ─────────────────────────────────────────────────────────────
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
interface BizSettings {
  notifications?: { whatsapp?: boolean }
}

interface ReminderRow {
  id:             string
  appointment_id: string
  business_id:    string
  businesses:     { name: string; settings: BizSettings | null } | null
  appointments:   {
    start_at: string
    clients:  { name: string; phone: string | null } | null
  } | null
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // ── Auth: Bearer CRON_SECRET ────────────────────────────────────────────
  const cronSecret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('authorization')

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Admin Supabase client (bypasses RLS for cross-tenant queries) ────────
  const supabaseUrl     = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Fetch pending reminders due now ─────────────────────────────────────
  const now = new Date().toISOString()

  const { data: reminders, error: fetchErr } = await supabase
    .from('appointment_reminders')
    .select(`
      id,
      appointment_id,
      business_id,
      businesses ( name, settings ),
      appointments (
        start_at,
        clients ( name, phone )
      )
    `)
    .eq('status', 'pending')
    .lte('remind_at', now)
    .limit(100)

  if (fetchErr) {
    console.error('[cron-reminders] fetch error:', fetchErr.message)
    return json({ error: fetchErr.message }, 500)
  }

  if (!reminders || reminders.length === 0) {
    return json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0 })
  }

  const results = { sent: 0, failed: 0, skipped: 0 }

  // ── Process each reminder ────────────────────────────────────────────────
  for (const raw of reminders) {
    const reminder = raw as unknown as ReminderRow
    const apt      = reminder.appointments

    if (!apt) {
      results.skipped++
      continue
    }

    // Skip if business explicitly disabled WhatsApp notifications
    const bizSettings = reminder.businesses?.settings
    if (bizSettings?.notifications?.whatsapp === false) {
      results.skipped++
      continue
    }

    const client = apt.clients
    if (!client?.phone) {
      await supabase
        .from('appointment_reminders')
        .update({ status: 'failed', error_message: 'Client has no phone number' })
        .eq('id', reminder.id)
      results.skipped++
      continue
    }

    // Format date/time for the template message
    const startDate    = new Date(apt.start_at)
    const businessName = reminder.businesses?.name ?? 'tu negocio'

    const date = startDate.toLocaleDateString('es-CO', {
      weekday: 'long',
      day:     'numeric',
      month:   'long',
      year:    'numeric',
    })
    const time = startDate.toLocaleTimeString('es-CO', {
      hour:   '2-digit',
      minute: '2-digit',
    })

    // ── Delegate to whatsapp-service Edge Function ───────────────────────
    const whatsappUrl = `${supabaseUrl}/functions/v1/whatsapp-service`

    try {
      const res = await fetch(whatsappUrl, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': cronSecret,
        },
        body: JSON.stringify({
          to:           client.phone,
          clientName:   client.name,
          businessName,
          date,
          time,
        }),
      })

      const data = await res.json().catch(() => ({ success: false })) as {
        success?: boolean
        error?:   string
      }

      if (data.success) {
        await supabase
          .from('appointment_reminders')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', reminder.id)
        results.sent++

        // ── Web Push al dueño del negocio (non-blocking, best-effort) ───
        // El cliente ya recibió WhatsApp; el dueño recibe push en su dispositivo.
        const pushUrl = `${supabaseUrl}/functions/v1/push-notify`
        fetch(pushUrl, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-internal-secret': cronSecret,
          },
          body: JSON.stringify({
            business_id: reminder.business_id,
            title:       '⏰ Recordatorio enviado',
            body:        `Cita con ${client.name} · ${time}`,
            url:         '/dashboard',
          }),
        }).catch(err => console.warn('[cron-reminders] push-notify call failed:', err))

      } else {
        const errMsg = data.error ?? `HTTP ${res.status}`
        await supabase
          .from('appointment_reminders')
          .update({ status: 'failed', error_message: errMsg })
          .eq('id', reminder.id)
        results.failed++
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Fetch error'
      await supabase
        .from('appointment_reminders')
        .update({ status: 'failed', error_message: errMsg })
        .eq('id', reminder.id)
      results.failed++
    }
  }

  return json({
    ok:        true,
    processed: reminders.length,
    ...results,
  })
})
