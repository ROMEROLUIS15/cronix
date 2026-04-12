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
          const mins = Math.ceil(err.retryAfterSecs / 60)
          captureException(err, { stage: 'whisper_rate_limit', sender })
          await sendWhatsAppMessage(sender, `Estoy atendiendo muchas consultas de voz. Por favor intenta de nuevo en ${mins} minuto${mins > 1 ? 's' : ''}.`)
          await flushSentry()
          return json({ success: true })
        }
        if (err instanceof CircuitBreakerError) {
          addBreadcrumb('Whisper Circuit open hit', 'llm', 'error')
          await sendWhatsAppMessage(sender, "🤖 Lo siento, mi sistema de voz está en mantenimiento breve. ¿Podrías escribirme tu consulta por favor?")
          await flushSentry()
          return json({ success: true })
        }
        captureException(err, { stage: 'voice_transcription', sender })
        await sendWhatsAppMessage(sender, "No pude procesar tu mensaje de voz correctamente. ¿Podrías escribirlo o intentar de nuevo?")
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
      addBreadcrumb('Message rate limited', 'rate-limit', 'warning')
      await sendWhatsAppMessage(sender, "⚠️ Estás enviando mensajes demasiado rápido. Por favor, espera un minuto antes de continuar.")
      await flushSentry()
      return json({ success: true, message: 'Rate limited — user notified' })
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

    const dailyTokenLimit = (business.settings as WaBusinessSettings)?.wa_daily_token_limit ?? 50000
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
      await sendWhatsAppMessage(sender, "🤖 Lo siento, este negocio ha alcanzado su límite de procesamiento diario. Por favor intenta de nuevo mañana o contacta al administrador.")
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
      getConversationHistory(business.id, sender, 4),
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
        addBreadcrumb('LLM Rate limit hit', 'llm', 'warning', { retryAfter: err.retryAfterSecs })
        captureException(err, { stage: 'ai_rate_limit', sender })
        const mins = Math.ceil(err.retryAfterSecs / 60)
        await sendWhatsAppMessage(sender, `Estoy atendiendo muchas consultas. Por favor intenta de nuevo en ${mins} minuto${mins > 1 ? 's' : ''}.`)
        await flushSentry()
        return json({ success: true })
      }
      if (err instanceof CircuitBreakerError) {
        addBreadcrumb('LLM Circuit open hit', 'llm', 'error')
        await sendWhatsAppMessage(sender, "🤖 Lo siento, mi cerebro de IA está en mantenimiento breve. Por favor, intenta de nuevo en un minuto.")
        await flushSentry()
        return json({ success: true })
      }
      captureException(err, { stage: 'ai_processing_failure', sender, prompt_length: text.length })
      await sendWhatsAppMessage(sender, 'Hubo un problema técnico al procesar tu mensaje. Por favor, inténtalo de nuevo en un momento.')
      await flushSentry()
      return json({ success: true })
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

    try {
      const payload = JSON.parse(rawBody) as MetaWebhookPayload
      const failSender = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
      if (failSender) {
        await sendWhatsAppMessage(failSender, "⚠️ Lo siento, tuve un problema técnico al procesar tu mensaje. Por favor intenta de nuevo en un momento.")
      }
    } catch (notifyErr) {
      captureException(notifyErr, { stage: 'notify_user_of_error' })
    }

    await flushSentry()
    return json({ error: 'Internal Server Error' }, 500)
  }
}
