/**
 * Supabase Edge Function — WhatsApp AI Webhook
 *
 * Security layers:
 *  1. Meta HMAC-SHA256 signature verification (prevents spoofed requests)
 *  2. Message rate limiting — 10 msgs / 60s per phone (fn_wa_check_rate_limit)
 *  3. Message sanitization — strips prompt injection patterns
 *  4. Booking rate limiting — 2 bookings / 24h per phone (fn_wa_check_booking_limit)
 *  5. Action tag regex parsing — LLM cannot self-execute; index.ts is the executor
 */

import { serve }                   from "https://deno.land/std@0.168.0/http/server.ts"
import { processConversation,
         LlmRateLimitError }        from "./ai-agent.ts"
import { sendWhatsAppMessage }      from "./whatsapp.ts"
import type {
  MetaWebhookPayload,
  BusinessRagContext,
  WaBusinessSettings,
}                                   from "./types.ts"
import {
  getBusinessByPhone,
  getBusinessServices,
  getClientByPhone,
  getActiveAppointments,
  getConversationHistory,
  getAvailableSlots,
  createAppointment,
  rescheduleAppointment,
  cancelAppointmentById,
  checkMessageRateLimit,
  checkBookingRateLimit,
  logInteraction,
  localTimeToUTC,
}                                   from "./database.ts"
import {
  initSentry,
  captureException,
  addBreadcrumb,
  setSentryTag,
  flushSentry,
}                                   from "../_shared/sentry.ts"

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

// ── Meta HMAC signature verification ─────────────────────────────────────────

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

// ── Message sanitization (anti prompt-injection) ──────────────────────────────

function sanitizeMessage(text: string): string {
  return text
    .slice(0, 500)
    // Strip fake action tags (prevent crafted commands from bypassing executor)
    .replace(/\[(CONFIRM|RESCHEDULE|CANCEL)_BOOKING[^\]]*\]/gi, '')
    // Strip known prompt injection patterns
    .replace(/ignore\s+previous\s+instructions?/gi, '')
    .replace(/system\s+prompt:/gi, '')
    .replace(/you\s+are\s+now/gi, '')
    // Strip markdown/XML that could confuse structured prompts
    .replace(/<[^>]+>/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Action tag regexes ────────────────────────────────────────────────────────
// These are the ONLY valid execution triggers — the LLM cannot self-execute.

const CONFIRM_TAG_RE    = /\[CONFIRM_BOOKING:\s*([a-f0-9-]{36}),\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2})\]/i
const RESCHEDULE_TAG_RE = /\[RESCHEDULE_BOOKING:\s*([a-f0-9-]{36}),\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2})\]/i
const CANCEL_TAG_RE     = /\[CANCEL_BOOKING:\s*([a-f0-9-]{36})\]/i
const ALL_TAGS_RE       = /\[(CONFIRM|RESCHEDULE|CANCEL)_BOOKING:[^\]]*\]/gi

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const { method } = req

  if (method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  // ── Webhook verification (GET) ────────────────────────────────────────────
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

  // ── Incoming message (POST) ───────────────────────────────────────────────
  if (method === 'POST') {
    const rawBody = await req.text()

    // Layer 1: Meta HMAC verification
    const isValid = await verifyMetaSignature(req.headers.get('x-hub-signature-256'), rawBody)
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
      const rawText      = msg.text?.body
      const waIdentifier = value?.metadata?.phone_number_id
                        ?? value?.metadata?.display_phone_number

      if (!rawText || !waIdentifier) {
        await flushSentry()
        return json({ success: true, message: 'Non-text message or missing metadata' })
      }

      // Layer 2: Message rate limit
      const withinRateLimit = await checkMessageRateLimit(sender)
      if (!withinRateLimit) {
        addBreadcrumb('Message rate limited', 'rate-limit', 'warning')
        // Fail-secure: do not respond (avoids confirming the phone is active to spammers)
        await flushSentry()
        return json({ success: true })
      }

      // Layer 3: Sanitize message (anti prompt-injection)
      const text = sanitizeMessage(rawText)
      addBreadcrumb('Message sanitized', 'security', 'info', { length: text.length })

      // Resolve tenant
      const business = await getBusinessByPhone(waIdentifier)
      if (!business) {
        await flushSentry()
        return json({ success: false, error: 'Business not found' })
      }

      setSentryTag('business_id',   business.id)
      setSentryTag('business_name', business.name)
      addBreadcrumb('Business resolved', 'tenant', 'info', { business_id: business.id })

      const timezone = business.timezone ?? 'UTC'

      // Fetch full context in parallel where possible
      const [services, client] = await Promise.all([
        getBusinessServices(business.id),
        getClientByPhone(business.id, sender),
      ])

      const [activeAppointments, history] = await Promise.all([
        client ? getActiveAppointments(business.id, client.id) : Promise.resolve([]),
        getConversationHistory(business.id, sender, 4),
      ])

      addBreadcrumb('Context fetched', 'database', 'info', {
        has_client:          !!client,
        active_appointments: activeAppointments.length,
        history_items:       history.length,
      })

      const context: BusinessRagContext = {
        business: {
          id:       business.id,
          name:     business.name,
          timezone,
          settings: (business.settings ?? {}) as WaBusinessSettings,
        },
        services,
        client,
        activeAppointments,
        history,
      }

      addBreadcrumb('Sending prompt to AI model', 'llm', 'info', { model: 'llama-3.3-70b-versatile' })

      // ── AI call ───────────────────────────────────────────────────────────
      let aiResponse: string
      try {
        aiResponse = await processConversation(text, context, customerName)
      } catch (err) {
        if (err instanceof LlmRateLimitError) {
          const mins = Math.ceil(err.retryAfterSecs / 60)
          const msg  = `Estoy atendiendo muchas consultas. Por favor intenta de nuevo en ${mins} minuto${mins > 1 ? 's' : ''}.`
          await sendWhatsAppMessage(sender, msg, value?.metadata?.phone_number_id)
          await flushSentry()
          return json({ success: true })
        }
        throw err
      }

      addBreadcrumb('AI response received', 'llm', 'info', { length: aiResponse.length })

      // ── Action tag parsing ─────────────────────────────────────────────────
      // Tags in the LLM response trigger real DB mutations.
      // The clean response (tags stripped) is what the user sees.

      const confirmMatch    = CONFIRM_TAG_RE.exec(aiResponse)
      const rescheduleMatch = RESCHEDULE_TAG_RE.exec(aiResponse)
      const cancelMatch     = CANCEL_TAG_RE.exec(aiResponse)

      if (confirmMatch) {
        const [, serviceId, date, time] = confirmMatch

        addBreadcrumb('CONFIRM_BOOKING tag detected', 'booking', 'info', { date })

        // Layer 4: Booking rate limit
        const bookingAllowed = await checkBookingRateLimit(sender, business.id)
        if (!bookingAllowed) {
          const limitMsg = 'Has alcanzado el límite de citas nuevas por hoy. Por favor contáctanos directamente para más ayuda.'
          await sendWhatsAppMessage(sender, limitMsg, value?.metadata?.phone_number_id)
          await logInteraction({ business_id: business.id, sender_phone: sender, message_text: text, ai_response: 'BOOKING_RATE_LIMITED' })
          await flushSentry()
          return json({ success: true })
        }

        try {
          await createAppointment(business.id, {
            client_phone: sender,
            client_name:  client?.name ?? customerName,
            service_id:   serviceId,
            date,
            time,
            timezone,
          })
          addBreadcrumb('Appointment created via WhatsApp AI', 'booking', 'info')
        } catch (err) {
          captureException(err, { stage: 'create_appointment', service_id: serviceId, date })
        }
      }

      if (rescheduleMatch) {
        const [, appointmentId, date, time] = rescheduleMatch

        addBreadcrumb('RESCHEDULE_BOOKING tag detected', 'booking', 'info', { date })

        try {
          const newStartAt = localTimeToUTC(date, time, timezone)
          await rescheduleAppointment(appointmentId, newStartAt)
          addBreadcrumb('Appointment rescheduled via WhatsApp AI', 'booking', 'info')
        } catch (err) {
          captureException(err, { stage: 'reschedule_appointment', appointment_id: appointmentId })
        }
      }

      if (cancelMatch) {
        const [, appointmentId] = cancelMatch

        addBreadcrumb('CANCEL_BOOKING tag detected', 'booking', 'info')

        try {
          await cancelAppointmentById(appointmentId)
          addBreadcrumb('Appointment cancelled via WhatsApp AI', 'booking', 'info')
        } catch (err) {
          captureException(err, { stage: 'cancel_appointment', appointment_id: appointmentId })
        }
      }

      // Strip all tags before sending to the user
      const cleanResponse = aiResponse.replace(ALL_TAGS_RE, '').replace(/\s{2,}/g, ' ').trim()

      await sendWhatsAppMessage(sender, cleanResponse, value?.metadata?.phone_number_id)

      // Log full response (including tags) for audit trail
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
