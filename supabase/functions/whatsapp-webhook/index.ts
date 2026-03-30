/**
 * Supabase Edge Function — WhatsApp AI Webhook
 */

import { serve }             from "https://deno.land/std@0.168.0/http/server.ts"
import { processConversation } from "./ai-agent.ts"
import { sendWhatsAppMessage }  from "./whatsapp.ts"
import type {
  MetaWebhookPayload,
  AppointmentPayload,
  BusinessRagContext,
  WaBusinessSettings,
} from "./types.ts"
import { getBusinessByPhone, getBusinessServices,
         createAppointment, logInteraction }         from "./database.ts"
import { initSentry, captureException, addBreadcrumb,
         setSentryTag, flushSentry }                 from "../_shared/sentry.ts"

// Initialize once per cold start — Deno module cache ensures a single call
initSentry('whatsapp-webhook')

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ── Meta webhook signature verification ──────────────────────────────────────

async function verifyMetaSignature(signature: string | null, rawBody: string): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!appSecret || !signature?.startsWith('sha256=')) return false

  const expectedHash = signature.slice(7)
  const encoder      = new TextEncoder()
  const key          = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac          = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const computedHash = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return computedHash === expectedHash
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const { method } = req

  if (method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  if (method === 'GET') {
    const url         = new URL(req.url)
    const mode        = url.searchParams.get('hub.mode')
    const token       = url.searchParams.get('hub.verify_token')
    const challenge   = url.searchParams.get('hub.challenge')
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN')

    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Verification failed', { status: 403 })
  }

  if (method === 'POST') {
    const rawBody = await req.text()

    const isValid = await verifyMetaSignature(
      req.headers.get('x-hub-signature-256'),
      rawBody
    )
    if (!isValid) {
      await flushSentry()
      return new Response('Unauthorized', { status: 401 })
    }

    addBreadcrumb('Meta HMAC signature verified', 'security')

    try {
      const body: MetaWebhookPayload = JSON.parse(rawBody)
      const value    = body.entry?.[0]?.changes?.[0]?.value
      const messages = value?.messages

      if (body.object !== 'whatsapp_business_account' || !messages?.[0]) {
        await flushSentry()
        return json({ success: true, message: 'Event ignored' })
      }

      const msg          = messages[0]
      const sender       = msg.from
      const customerName = value?.contacts?.[0]?.profile?.name ?? 'Cliente'
      const text         = msg.text?.body
      const waIdentifier = value?.metadata?.phone_number_id
                        ?? value?.metadata?.display_phone_number

      addBreadcrumb('WhatsApp message received', 'webhook', 'info', {
        has_text:      !!text,
        wa_identifier: waIdentifier,
      })

      if (!text || !waIdentifier) {
        await flushSentry()
        return json({ success: true, message: 'Non-text message or missing metadata' })
      }

      const business = await getBusinessByPhone(waIdentifier)
      if (!business) {
        await flushSentry()
        return json({ success: false, error: 'Business not found' })
      }

      setSentryTag('business_id',   business.id)
      setSentryTag('business_name', business.name)
      addBreadcrumb('Business resolved', 'tenant', 'info', { business_id: business.id })

      const services = await getBusinessServices(business.id)
      const timezone = business.timezone ?? 'UTC'

      // Build BusinessRagContext for the new ai-agent.ts API
      const context: BusinessRagContext = {
        business: {
          id:       business.id,
          name:     business.name,
          timezone: timezone,
          settings: (business.settings ?? {}) as WaBusinessSettings,
        },
        services,
        client:             null,
        activeAppointments: [],
        history:            [],
      }

      addBreadcrumb('Sending prompt to AI model', 'llm', 'info', {
        model:    'llama-3.3-70b-versatile',
        timezone: timezone,
      })

      const aiResponse = await processConversation(text, context, customerName)

      addBreadcrumb('AI response received', 'llm', 'info', {
        response_length: aiResponse?.length ?? 0,
      })

      await sendWhatsAppMessage(sender, aiResponse, value?.metadata?.phone_number_id)

      await logInteraction({
        business_id:  business.id,
        sender_phone: sender,
        message_text: text,
        ai_response:  aiResponse,
      })

      await flushSentry()
      return json({ success: true })
    } catch (error) {
      captureException(error, { stage: 'webhook_post_handler' })
      await flushSentry()
      return json({ error: 'Internal Server Error' }, 500)
    }
  }

  await flushSentry()
  return json({ error: 'Method not allowed' }, 405)
})
