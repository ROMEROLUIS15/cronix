/**
 * Supabase Edge Function — WhatsApp Appointment Reminders
 *
 * Receives reminder payload from the Next.js cron route and calls
 * Meta WhatsApp Cloud API. Credentials are stored as Supabase Secrets
 * (never exposed to the client or Vercel env).
 *
 * Required Supabase Secrets:
 *   WHATSAPP_PHONE_NUMBER_ID  — from Meta Business Manager
 *   WHATSAPP_ACCESS_TOKEN     — permanent or temporary token
 *   CRON_SECRET               — shared secret with Next.js cron route
 *   SENTRY_DSN                — optional, enables error tracking
 *
 * Deploy: npx supabase functions deploy whatsapp-service
 */

import { initSentry, captureException, addBreadcrumb, flushSentry } from '../_shared/sentry.ts'

initSentry('whatsapp-service')

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

const WA_API_BASE = 'https://graph.facebook.com/v19.0'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    await flushSentry()
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Auth: verify internal secret matches CRON_SECRET ──────────────────
  const internalSecret = req.headers.get('x-internal-secret')
  const cronSecret     = Deno.env.get('CRON_SECRET')

  if (!cronSecret || internalSecret !== cronSecret) {
    await flushSentry()
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Parse payload ──────────────────────────────────────────────────────
  let to: string, clientName: string, businessName: string, date: string, time: string, template = 'appointment_reminder'
  try {
    const body = await req.json()
    ;({ to, clientName, businessName, date, time, template = 'appointment_reminder' } = body)
    if (!to || !clientName) throw new Error('Missing required fields')
  } catch (e) {
    captureException(e, { stage: 'parse_body' })
    await flushSentry()
    return json({ error: 'Invalid request body' }, 400)
  }

  // ── WhatsApp credentials ───────────────────────────────────────────────
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')

  if (!phoneNumberId || !accessToken) {
    captureException(new Error('WhatsApp credentials not configured'), {
      stage:    'credentials_check',
      missing:  !phoneNumberId ? 'WHATSAPP_PHONE_NUMBER_ID' : 'WHATSAPP_ACCESS_TOKEN',
    })
    await flushSentry()
    return json({ success: false, error: 'WhatsApp credentials not configured' })
  }

  // Normalize phone: strip spaces, dashes, parens, leading +
  const phone = to.replace(/[\s\-\+\(\)]/g, '')

  addBreadcrumb('Calling Meta WhatsApp API', 'whatsapp', 'info', {
    phone_number_id: phoneNumberId,
    template,
  })

  // ── Template Configuration ─────────────────────────────────────────────
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: clientName   },
        { type: 'text', text: businessName },
      ],
    },
  ]

  // Add specific params based on template
  if (template === 'appointment_reminder') {
    components[0].parameters.push({ type: 'text', text: date })
    components[0].parameters.push({ type: 'text', text: time })
  }

  // ── Call Meta API ──────────────────────────────────────────────────────
  try {
    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${accessToken}`,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                phone,
        type:              'template',
        template: {
          name:     template,
          language: { code: 'es' },
          components,
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const msg     = (errBody as { error?: { message?: string } })?.error?.message
      // Capture Meta API errors — critical for diagnosing token expiry or template issues
      captureException(new Error(`Meta API error: ${msg ?? `HTTP ${res.status}`}`), {
        stage:       'meta_api_call',
        http_status: res.status,
        meta_error:  msg,
        business:    businessName,
      })
      await flushSentry()
      return json({ success: false, error: msg ?? `HTTP ${res.status}` })
    }

    addBreadcrumb('WhatsApp message sent successfully', 'whatsapp', 'info')
    await flushSentry()
    return json({ success: true })
  } catch (e) {
    captureException(e, { stage: 'meta_api_call', business: businessName })
    await flushSentry()
    return json({
      success: false,
      error:   e instanceof Error ? e.message : 'Unknown error',
    })
  }
})
