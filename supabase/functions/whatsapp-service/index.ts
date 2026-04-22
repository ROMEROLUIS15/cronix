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
  let to: string,
      type: string,
      message: string | undefined,
      clientName: string,
      businessName: string,
      date: string,
      time: string,
      template: string,
      parameters: string[],
      languageCode: string

  try {
    const body = await req.json() as Record<string, unknown>
    to           = body['to']           as string
    type         = (body['type']        as string | undefined) ?? 'template'
    message      = body['message']      as string | undefined
    clientName   = (body['clientName']  as string | undefined) ?? ''
    businessName = (body['businessName'] as string | undefined) ?? ''
    date         = (body['date']        as string | undefined) ?? ''
    time         = (body['time']        as string | undefined) ?? ''
    template     = (body['template']    as string | undefined) ?? 'appointment_reminder'
    parameters   = Array.isArray(body['parameters']) ? (body['parameters'] as string[]) : []
    languageCode = (body['languageCode'] as string | undefined) ?? 'es'

    if (!to) throw new Error('Missing required field: to')
    if (type === 'text' && !message) throw new Error('Missing required field: message for type text')
    // Template mode: accept either legacy (clientName) or new generic (parameters[])
    if (type === 'template' && !clientName && parameters.length === 0) {
      throw new Error('Missing required field: clientName or parameters[] for type template')
    }
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
      stage:   'credentials_check',
      missing: !phoneNumberId ? 'WHATSAPP_PHONE_NUMBER_ID' : 'WHATSAPP_ACCESS_TOKEN',
    })
    await flushSentry()
    return json({ success: false, error: 'WhatsApp credentials not configured' })
  }

  // Normalize phone: strip spaces, dashes, parens, leading +
  const phone = to.replace(/[\s\-\+\(\)]/g, '')

  addBreadcrumb('Calling Meta WhatsApp API', 'whatsapp', 'info', {
    phone_number_id: phoneNumberId,
    type,
    template: type === 'template' ? template : undefined,
  })

  // ── Build Meta API payload ─────────────────────────────────────────────
  let waPayload: Record<string, unknown>

  if (type === 'text') {
    waPayload = {
      messaging_product: 'whatsapp',
      to:                phone,
      type:              'text',
      text:              { body: message },
    }
  } else {
    // Build template parameters.
    //   - Generic mode (new): caller provides `parameters[]` directly — used by
    //     templates like `daily_owner_summary` that don't fit the legacy shape.
    //   - Legacy mode: preserved exactly for `appointment_reminder` callers.
    let templateParams: Array<{ type: 'text'; text: string }>

    if (parameters.length > 0) {
      templateParams = parameters.map(p => ({ type: 'text' as const, text: p }))
    } else {
      templateParams = [
        { type: 'text', text: clientName   },
        { type: 'text', text: businessName },
      ]
      if (template === 'appointment_reminder') {
        templateParams.push({ type: 'text', text: date })
        templateParams.push({ type: 'text', text: time })
      }
    }

    waPayload = {
      messaging_product: 'whatsapp',
      to:                phone,
      type:              'template',
      template: {
        name:       template,
        language:   { code: languageCode },
        components: [{ type: 'body', parameters: templateParams }],
      },
    }
  }

  // ── Call Meta API ──────────────────────────────────────────────────────
  try {
    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(waPayload),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const msg     = (errBody as { error?: { message?: string } })?.error?.message
      captureException(new Error(`Meta API error: ${msg ?? `HTTP ${res.status}`}`), {
        stage:       'meta_api_call',
        http_status: res.status,
        meta_error:  msg,
        business:    businessName,
        type,
      })
      await flushSentry()
      return json({ success: false, error: msg ?? `HTTP ${res.status}` })
    }

    addBreadcrumb('WhatsApp message sent successfully', 'whatsapp', 'info', { type })
    await flushSentry()
    return json({ success: true })
  } catch (e) {
    captureException(e, { stage: 'meta_api_call', business: businessName, type })
    await flushSentry()
    return json({
      success: false,
      error:   e instanceof Error ? e.message : 'Unknown error',
    })
  }
})
