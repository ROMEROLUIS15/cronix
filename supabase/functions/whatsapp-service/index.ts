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
 *
 * Deploy: npx supabase functions deploy whatsapp-service
 */

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
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Auth: verify internal secret matches CRON_SECRET ──────────────────
  const internalSecret = req.headers.get('x-internal-secret')
  const cronSecret     = Deno.env.get('CRON_SECRET')

  if (!cronSecret || internalSecret !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Parse payload ──────────────────────────────────────────────────────
  let to: string, clientName: string, businessName: string, date: string, time: string
  try {
    const body = await req.json()
    ;({ to, clientName, businessName, date, time } = body)
    if (!to || !clientName) throw new Error('Missing required fields')
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400)
  }

  // ── WhatsApp credentials ───────────────────────────────────────────────
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')

  if (!phoneNumberId || !accessToken) {
    return json({ success: false, error: 'WhatsApp credentials not configured' })
  }

  // Normalize phone: strip spaces, dashes, parens, leading +
  const phone = to.replace(/[\s\-\+\(\)]/g, '')

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
          name:     'appointment_reminder',
          language: { code: 'es' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: clientName   },
                { type: 'text', text: businessName },
                { type: 'text', text: date         },
                { type: 'text', text: time         },
              ],
            },
          ],
        },
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const msg  = (body as { error?: { message?: string } })?.error?.message
      return json({ success: false, error: msg ?? `HTTP ${res.status}` })
    }

    return json({ success: true })
  } catch (e) {
    return json({
      success: false,
      error:   e instanceof Error ? e.message : 'Unknown error',
    })
  }
})
