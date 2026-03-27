/**
 * Supabase Edge Function — WhatsApp AI Webhook
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { processConversation }                                          from "./gemini.ts"
import { sendWhatsAppMessage }                                          from "./whatsapp.ts"
import type { AppointmentPayload }                                      from "./database.ts"
import { getBusinessByPhone, getBusinessServices, getAvailableSlots,
         createAppointment, logInteraction }                            from "./database.ts"

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
// Prevents spoofed POST requests from reaching the agent.
// Requires env var: WHATSAPP_APP_SECRET (Meta App Secret, not the access token).

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

// ── Meta webhook payload types ────────────────────────────────────────────────

interface MetaContact {
  profile?: { name?: string }
}

interface MetaMessage {
  from:  string
  text?: { body: string }
}

interface MetaMetadata {
  phone_number_id?:      string
  display_phone_number?: string
}

interface MetaValue {
  messages?: MetaMessage[]
  contacts?: MetaContact[]
  metadata?: MetaMetadata
}

interface MetaEntry {
  changes?: Array<{ value?: MetaValue }>
}

interface MetaWebhookPayload {
  object?: string
  entry?:  MetaEntry[]
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
    // Read raw body first — req.json() and req.text() can only be called once
    const rawBody = await req.text()

    const isValid = await verifyMetaSignature(
      req.headers.get('x-hub-signature-256'),
      rawBody
    )
    if (!isValid) {
      return new Response('Unauthorized', { status: 401 })
    }

    try {
      const body: MetaWebhookPayload = JSON.parse(rawBody)
      const value    = body.entry?.[0]?.changes?.[0]?.value
      const messages = value?.messages

      if (body.object !== 'whatsapp_business_account' || !messages?.[0]) {
        return json({ success: true, message: 'Event ignored' })
      }

      const msg          = messages[0]
      const sender       = msg.from
      const customerName = value?.contacts?.[0]?.profile?.name ?? 'Cliente'
      const text         = msg.text?.body
      const waIdentifier = value?.metadata?.phone_number_id
                        ?? value?.metadata?.display_phone_number

      if (!text || !waIdentifier) {
        return json({ success: true, message: 'Non-text message or missing metadata' })
      }

      const business = await getBusinessByPhone(waIdentifier)
      if (!business) {
        return json({ success: false, error: 'Business not found' })
      }

      const services = await getBusinessServices(business.id)
      const timezone = business.timezone ?? 'UTC'

      const aiResponse = await processConversation(
        text,
        {
          businessName: business.name,
          services,
          currentTime:  new Date().toLocaleString('es-ES', { timeZone: timezone }),
          customerName
        },
        async (name, args) => {
          if (name === 'get_available_slots') {
            return getAvailableSlots(business.id, args.date, args.service_id, timezone)
          }
          if (name === 'create_appointment') {
            const payload: AppointmentPayload = {
              client_phone: sender,
              client_name:  args.client_name ?? customerName,
              service_id:   args.service_id,
              date:         args.date,
              time:         args.time,
              timezone,
            }
            return createAppointment(business.id, payload)
          }
          return { error: 'Tool not found' }
        }
      )

      await sendWhatsAppMessage(sender, aiResponse, value?.metadata?.phone_number_id)

      await logInteraction({
        business_id:  business.id,
        sender_phone: sender,
        message_text: text,
        ai_response:  aiResponse
      })

      return json({ success: true })
    } catch (error) {
      return json({ error: 'Internal Server Error' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
})
