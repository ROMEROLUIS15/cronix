/**
 * Supabase Edge Function — push-notify
 *
 * Sends Web Push notifications (RFC 8030 + RFC 8291) to all subscriptions
 * belonging to the requesting user's business (multi-tenant safe).
 *
 * Auth — two paths:
 *  A) x-internal-secret: <CRON_SECRET>  → server call (cron-reminders, DB webhooks)
 *  B) Authorization: Bearer <JWT>        → browser call (new appointment created)
 *
 * Crypto lives in vapid.ts (VAPID JWT + AES-GCM payload encryption).
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { initSentry, captureException, addBreadcrumb, setSentryTag, flushSentry } from '../_shared/sentry.ts'
import { sendWebPush }   from './vapid.ts'
import type { PushPayload } from './vapid.ts'
import { resolveBusinessIdFromJwt } from './modules/auth.ts'
import { fetchSubscriptions, purgeExpiredSubscriptions } from './modules/subscription-manager.ts'
import { fanOutPush } from './modules/push-sender.ts'

initSentry('push-notify')

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    await flushSentry()
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    await flushSentry()
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const cronSecret     = Deno.env.get('CRON_SECRET')
  const internalSecret = req.headers.get('x-internal-secret')
  const isInternalCall = !!cronSecret && internalSecret === cronSecret

  let businessId: string

  if (isInternalCall) {
    // PATH A — internal call (cron or Database Webhook on appointments INSERT)
    if (body.type === 'INSERT' && body.table === 'appointments' && body.record) {
      const record = body.record as Record<string, unknown>
      businessId   = record.business_id as string
      body.title   = '¡Nueva Reserva!'
      body.body    = `Nueva cita recibida para el ${String(record.start_at).split('T')[0]}.`
    } else if (!body.business_id) {
      await flushSentry()
      return json({ error: 'business_id required for internal calls' }, 400)
    } else {
      businessId = body.business_id as string
    }
  } else {
    // PATH B — user JWT from the browser
    const authHeader = req.headers.get('authorization') ?? ''
    const resolved = await resolveBusinessIdFromJwt(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      authHeader
    )

    if (!resolved) {
      await flushSentry()
      return json({ error: 'Unauthorized' }, 401)
    }
    businessId = resolved
  }

  setSentryTag('business_id', businessId)
  addBreadcrumb('Auth resolved, business identified', 'auth', 'info', {
    path: isInternalCall ? 'internal' : 'jwt',
  })

  // ── VAPID credentials ────────────────────────────────────────────────────────
  const vapidPubKey  = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@cronix.app'

  if (!vapidPubKey || !vapidPrivKey) {
    captureException(new Error('VAPID keys not configured'), {
      stage: 'vapid_check', missing: !vapidPubKey ? 'VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY',
    })
    await flushSentry()
    return json({ error: 'VAPID keys not configured' }, 500)
  }

  // ── Fetch subscriptions ──────────────────────────────────────────────────────
  let subs: Awaited<ReturnType<typeof fetchSubscriptions>>
  try {
    subs = await fetchSubscriptions(businessId)
  } catch (err) {
    captureException(err, { stage: 'fetch_subscriptions', business_id: businessId })
    await flushSentry()
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }

  if (subs.length === 0) {
    await flushSentry()
    return json({ ok: true, sent: 0, total: 0 })
  }

  const payload: PushPayload = {
    title: body.title as string,
    body: body.body as string,
    url: body.url as string,
    icon: body.icon as string,
  }

  addBreadcrumb('Sending push notifications', 'push', 'info', { business_id: businessId, count: subs.length })

  // ── Fan out ──────────────────────────────────────────────────────────────────
  const result = await fanOutPush(subs, payload, vapidPubKey, vapidPrivKey, vapidSubject)

  // Purge expired subscriptions (best-effort)
  if (result.expiredEndpoints.length > 0) {
    try {
      await purgeExpiredSubscriptions(result.expiredEndpoints)
    } catch (err) {
      captureException(err, { stage: 'purge_expired_subs', business_id: businessId })
    }
  }

  await flushSentry()
  return json({ ok: true, sent: result.sent, failed: result.failed, total: subs.length })
})
