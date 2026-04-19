/**
 * Message Handler — full pipeline for a dequeued WhatsApp message.
 *
 * Security layers (in order):
 *  1. QStash signature verification
 *  2. Message rate limiting — 10 msgs / 60s per phone
 *  3. Business aggregate quota — 50 msgs / 60s per business
 *  4. Daily token quota (cost control)
 *  5. Message sanitization — strips prompt injection patterns
 *  6. Booking rate limiting — 2 bookings / 24h (inside runAgentLoop)
 */

import { runAgentLoop, transcribeAudio, LlmRateLimitError, CircuitBreakerError } from "./ai-agent.ts"
import { sendWhatsAppMessage, downloadMediaBuffer }                               from "./whatsapp.ts"
import type { MetaWebhookPayload, BusinessRagContext, WaBusinessSettings }        from "./types.ts"
import { checkMessageRateLimit, checkBusinessUsageLimit, checkTokenQuota, trackTokenUsage } from "./guards.ts"
import { getBusinessBySlug, verifyBusinessPhone, getSessionBusiness, upsertSession }        from "./business-router.ts"
import { getBusinessServices, getClientByPhone, getActiveAppointments,
         getConversationHistory, getBookedSlots }                                           from "./context-fetcher.ts"
import { logInteraction }    from "./audit.ts"
import { verifyQStash, sanitizeMessage } from "./security.ts"
import { captureException, addBreadcrumb, setSentryTag, flushSentry } from "../_shared/sentry.ts"
import { logToDLQ }          from "../_shared/supabase.ts"

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

// Returns 503 + Retry-After so QStash retries automatically after the rate limit window.
// The client never sees the error — they receive the response transparently once retried.
function retryLater(retryAfterSecs: number): Response {
  return new Response(JSON.stringify({ retry: true }), {
    status: 503,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Retry-After':  String(retryAfterSecs),
    },
  })
}

export async function handleMessage(req: Request): Promise<Response> {
  const { method } = req

  if (method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  if (method !== 'POST') {
    await flushSentry()
    return json({ error: 'Method not allowed' }, 405)
  }

  const rawBody = await req.text()

  // Layer 1: QStash Signature verification
  const isValid = await verifyQStash(req, rawBody)
  if (!isValid) {
    await flushSentry()
    return new Response('Unauthorized QStash Signature', { status: 401 })
  }

  addBreadcrumb('QStash signature verified', 'security')

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
    const waIdentifier = value?.metadata?.phone_number_id
                      ?? value?.metadata?.display_phone_number

    setSentryTag('sender_phone', sender)
    addBreadcrumb('Processing WhatsApp message', 'message', 'info', { sender, name: customerName })

    if (!waIdentifier) {
      await flushSentry()
      return json({ success: true, message: 'Missing metadata' })
    }

    // Extract text or transcribe voice note
    let rawText = msg.text?.body ?? null
    let whisperTokens = 0
    const wasAudio = !rawText && !!msg.audio?.id

    if (!rawText && msg.audio?.id) {
      addBreadcrumb('Voice note received, downloading media', 'whatsapp', 'info')
      try {
        const { buffer, mimeType } = await downloadMediaBuffer(msg.audio.id)
        addBreadcrumb('Media downloaded, transcribing with Whisper', 'llm', 'info')
        const result = await transcribeAudio(buffer, mimeType)
        rawText       = result.text
        whisperTokens = result.tokens
      } catch (err) {
        if (err instanceof LlmRateLimitError) {
          addBreadcrumb('Whisper rate limit — delegating retry to QStash', 'llm', 'warning', { retryAfter: err.retryAfterSecs })
          await flushSentry()
          return retryLater(err.retryAfterSecs)
        }
        if (err instanceof CircuitBreakerError) {
          addBreadcrumb('Whisper Circuit open hit — delegating retry to QStash buffer', 'llm', 'warning')
          await flushSentry()
          return retryLater(30)
        }
        captureException(err, { stage: 'voice_transcription', sender })
        await sendWhatsAppMessage(sender, "No pude procesar tu audio. Por favor intenta de nuevo o escríbeme tu consulta.")
        await flushSentry()
        return json({ success: true, message: 'Voice transcription failed — user notified' })
      }
    }

    if (!rawText) {
      if (wasAudio) {
        addBreadcrumb('Empty audio transcription — notifying user', 'whatsapp', 'warning')
        await sendWhatsAppMessage(sender, 'No pude entender tu mensaje de voz. ¿Podrías hablar más claro, acercarte al micrófono, o escribirme tu consulta?')
      }
      await flushSentry()
      return json({ success: true, message: wasAudio ? 'Empty transcription — user notified' : 'Non-text message' })
    }

    // Business Owner Verification intercept
    const textUpper = rawText.toUpperCase().trim()
    if (textUpper.startsWith('VINCULAR-')) {
      const slug   = textUpper.replace('VINCULAR-', '').toLowerCase()
      const result = await verifyBusinessPhone(slug, sender)

      if (result === 'ALREADY_VERIFIED') {
        await sendWhatsAppMessage(sender, `✅ *¡WhatsApp ya verificado!*\n\nEste número ya se encuentra vinculado correctamente al negocio. No es necesario realizar la vinculación de nuevo.\n\n_Seguridad Cronix_ 🛡️`)
      } else if (result) {
        await sendWhatsAppMessage(sender, `✅ *¡WhatsApp vinculado exitosamente!*\n\nTu número ha sido registrado para el negocio *${result}*.\nA partir de ahora recibirás alertas instantáneas cuando la Inteligencia Artificial agende nuevas citas.\n\n_Seguridad Cronix_ 🛡️`)
      } else {
        await sendWhatsAppMessage(sender, `❌ *Error de vinculación*\n\nNo se encontró ningún negocio con el identificador "${slug}". Verifica que el enlace sea correcto.`)
      }

      addBreadcrumb('Business phone verified natively', 'verification', 'info', { slug, sender })
      await flushSentry()
      return json({ success: true, message: 'Owner verification intercept processed' })
    }

    // Layer 2: Message rate limit
    const withinRateLimit = await checkMessageRateLimit(sender)
    if (!withinRateLimit) {
      addBreadcrumb('Message rate limited — spam dropped silently', 'rate-limit', 'warning')
      await flushSentry()
      return json({ success: true, message: 'Rate limited — spam dropped silently' })
    }

    // Slug extraction (BEFORE sanitization — # would be stripped)
    const slugMatch          = rawText.match(/#([a-z0-9][a-z0-9-]{1,30})/i)
    const slug               = slugMatch?.[1]?.toLowerCase() ?? null
    const rawTextWithoutSlug = slug ? rawText.replace(slugMatch![0], '').trim() : rawText

    // Layer 3: Sanitize message (anti prompt-injection)
    const text = sanitizeMessage(rawTextWithoutSlug)

    // Handle slug-only messages (client opened the WhatsApp link and sent just #slug)
    if (!text && slug) {
      const welcomeBiz = await getBusinessBySlug(slug)
      if (welcomeBiz) {
        await upsertSession(sender, welcomeBiz.id)
        await sendWhatsAppMessage(sender,
          `¡Hola! 👋 Bienvenido/a a *${welcomeBiz.name}*.\n` +
          `Soy tu asistente virtual de reservas. ¿En qué puedo ayudarte hoy?`
        )
        addBreadcrumb('Slug-only message — welcome sent', 'routing', 'info', { slug, sender })
      } else {
        await sendWhatsAppMessage(sender, `❌ No se encontró ningún negocio con ese enlace.`)
        addBreadcrumb('Slug not found on slug-only message', 'routing', 'warning', { slug })
      }
      await flushSentry()
      return json({ success: true, message: 'Slug-only message — welcome sent' })
    }

    if (!text) {
      addBreadcrumb('Message became empty after sanitization', 'security', 'info')
      await flushSentry()
      return json({ success: true, message: 'Empty text after sanitization' })
    }

    addBreadcrumb('Message sanitized', 'security', 'info', { length: text.length })

    // 3-tier tenant routing
    let business = slug ? await getBusinessBySlug(slug) : null

    if (business && slug) {
      await upsertSession(sender, business.id)
      addBreadcrumb('Business resolved by slug', 'tenant', 'info', { slug })
    }

    if (!business) {
      business = await getSessionBusiness(sender)
      if (business) addBreadcrumb('Business resolved by session', 'tenant', 'info')
    }

    if (!business) {
      await sendWhatsAppMessage(sender,
        '¡Hola! 👋 Soy el asistente virtual de reservas de *Cronix*.\n\n' +
        'Para comunicarte con un negocio y agendar una cita, necesitas usar su enlace directo de WhatsApp.\n\n' +
        '🔗 Encuentra todos los negocios disponibles en:\nhttps://cronix-app.vercel.app\n\n' +
        '¡Te esperamos!'
      )
      await flushSentry()
      return json({ success: true, message: 'No business routed — landing sent' })
    }

    setSentryTag('business_id',   business.id)
    setSentryTag('business_name', business.name)
    setSentryTag('business_slug', business.slug || 'unknown')
    addBreadcrumb('Business resolved', 'tenant', 'info', { business_id: business.id, slug: business.slug })

    if (whisperTokens > 0) await trackTokenUsage(business.id, whisperTokens)

    const dailyTokenLimit = (business.settings as WaBusinessSettings)?.wa_daily_token_limit ?? 300000
    const [withinBusinessQuota, withinTokenQuota] = await Promise.all([
      checkBusinessUsageLimit(business.id),
      checkTokenQuota(business.id, dailyTokenLimit),
    ])

    if (!withinBusinessQuota) {
      addBreadcrumb('Business rate limited', 'rate-limit', 'warning', { business_id: business.id })
      await flushSentry()
      return json({ success: true, message: 'Business quota exceeded — silent drop' })
    }

    if (!withinTokenQuota) {
      addBreadcrumb('Token quota exceeded', 'rate-limit', 'warning', { business_id: business.id })
      await sendWhatsAppMessage(sender, "🤖 Hemos procesado el volumen máximo de reservas automatizadas por hoy. Pero no te preocupes, tu solicitud fue guardada y el personal del negocio te atenderá directamente por este chat en la brevedad posible.")
      await flushSentry()
      return json({ success: true, message: 'Token quota exceeded — user notified' })
    }

    const timezone = business.timezone ?? 'UTC'

    const [services, client] = await Promise.all([
      getBusinessServices(business.id),
      getClientByPhone(business.id, sender),
    ])

    const [activeAppointments, history, bookedSlots] = await Promise.all([
      client ? getActiveAppointments(business.id, client.id) : Promise.resolve([]),
      getConversationHistory(business.id, sender, 2),
      getBookedSlots(business.id, timezone),
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
        phone:    business.phone ?? null,
        slug:     business.slug ?? null,
        settings: (business.settings ?? {}) as WaBusinessSettings,
      },
      services,
      client,
      activeAppointments,
      history,
      bookedSlots,
    }

    addBreadcrumb('Starting ReAct agent loop', 'llm', 'info', { model: 'llama-3.1-8b-instant + llama-3.3-70b-versatile' })

    let agentResult: { text: string; tokens: number; toolCallsTrace: unknown[] }
    try {
      agentResult = await runAgentLoop(text, context, customerName, sender)
      if (agentResult.tokens > 0) await trackTokenUsage(business.id, agentResult.tokens)
    } catch (err) {
      if (err instanceof LlmRateLimitError) {
        addBreadcrumb('LLM rate limit — delegating retry to QStash', 'llm', 'warning', { retryAfter: err.retryAfterSecs })
        await flushSentry()
        return retryLater(err.retryAfterSecs)
      }
      if (err instanceof CircuitBreakerError) {
        addBreadcrumb('LLM Circuit open hit — delegating retry to QStash', 'llm', 'warning')
        await flushSentry()
        return retryLater(30)
      }
      captureException(err, { stage: 'ai_processing_failure', sender, prompt_length: text?.length })
      await flushSentry()
      // Transient platform crashes go to a short QStash retry instead of alarming the client
      return retryLater(15)
    }

    addBreadcrumb('Agent loop finished', 'llm', 'info', { response_length: agentResult.text.length, tokens: agentResult.tokens })

    await sendWhatsAppMessage(sender, agentResult.text)

    await logInteraction({
      business_id:  business.id,
      sender_phone: sender,
      message_text: text,
      ai_response:  agentResult.text,
      tool_calls:   agentResult.toolCallsTrace.length > 0
        ? { steps: agentResult.toolCallsTrace }
        : undefined,
    })

    await flushSentry()
    return json({ success: true })

  } catch (error) {
    captureException(error, { stage: 'webhook_post_handler_qstash' })
    await logToDLQ(rawBody, error, 'process-whatsapp')

    await flushSentry()
    // By returning 202 instead of 500, we prevent QStash from infinite-looping fatal bugs or syntax crashes. 
    // The event is safely locked in the Dead Letter Queue for auditing, with no message leakage to the client.
    return json({ error: 'Internal logic failed, safely isolated to DLQ' }, 202)
  }
}
