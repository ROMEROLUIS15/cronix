/**
 * Supabase Edge Function — process-whatsapp
 *
 * This function processes the incoming WhatsApp messages ENQUEUED by QStash.
 * It is detached from the Meta Webhook response to avoid timeouts.
 *
 * Security layers:
 *  1. Serverless queue protection (QStash Receiver Header Verification).
 *  2. Message rate limiting — 10 msgs / 60s per phone (fn_wa_check_rate_limit)
 *  3. Business usage quota — 50 msgs / 60s per business (fn_wa_check_business_limit)
 *  4. Message sanitization — strips prompt injection patterns
 *  5. Booking rate limiting — 2 bookings / 24h per phone (handled inside runAgentLoop)
 */

import { serve }                   from "https://deno.land/std@0.168.0/http/server.ts"
import { Receiver }                from "https://esm.sh/@upstash/qstash@2.7.20"
import { runAgentLoop,
         transcribeAudio,
         LlmRateLimitError,
         CircuitBreakerError }     from "./ai-agent.ts"
import { sendWhatsAppMessage,
         downloadMediaBuffer }     from "./whatsapp.ts"
import type {
  MetaWebhookPayload,
  BusinessRagContext,
  WaBusinessSettings,
}                                  from "./types.ts"
import {
  getBusinessBySlug,
  verifyBusinessPhone,
  getSessionBusiness,
  upsertSession,
  getBusinessServices,
  getClientByPhone,
  getActiveAppointments,
  getConversationHistory,
  getBookedSlots,
  checkTokenQuota,
  trackTokenUsage,
  checkMessageRateLimit,
  checkBusinessUsageLimit,
  logInteraction,
}                                  from "./database.ts"
import {
  initSentry,
  captureException,
  addBreadcrumb,
  setSentryTag,
  flushSentry,
}                                  from "../_shared/sentry.ts"
import { logToDLQ }                from "../_shared/supabase.ts"

initSentry('process-whatsapp')

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

// ── QStash Security verification ─────────────────────────────────────────────
async function verifyQStash(req: Request, rawBody: string): Promise<boolean> {
  try {
    const signature = req.headers.get("Upstash-Signature");

    if (!signature) {
      addBreadcrumb("No Upstash-Signature header found", 'security', 'error');
      return false;
    }

    const currentKey = Deno.env.get("QSTASH_CURRENT_SIGNING_KEY");
    const nextKey    = Deno.env.get("QSTASH_NEXT_SIGNING_KEY");

    if (!currentKey || !nextKey) {
      captureException(new Error("QStash signing keys missing in env"), { stage: 'qstash_config' });
      return false;
    }

    const receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey:    nextKey,
    });

    const isValid = await receiver.verify({
      signature,
      body: rawBody,
    }).catch(err => {
      captureException(err, { stage: 'qstash_verify' });
      return false;
    });

    if (!isValid) {
      addBreadcrumb("QStash signature verification failed", 'security', 'warning');
    } else {
      addBreadcrumb("QStash signature valid", 'security', 'info');
    }

    return isValid;
  } catch (error) {
    captureException(error, { stage: 'qstash_validation' });
    return false;
  }
}

// ── Message sanitization (anti prompt-injection) ──────────────────────────────

function sanitizeMessage(text: string): string {
  return text
    .slice(0, 500)
    // Normalize unicode homoglyphs and zero-width chars before pattern matching
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // zero-width & soft-hyphen
    // Strip fake action tags (prevent crafted commands from bypassing executor)
    .replace(/\[(CONFIRM|RESCHEDULE|CANCEL)_BOOKING[^\]]*\]/gi, '')
    // English injection patterns
    .replace(/ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/gi, '')
    .replace(/system\s+prompt\s*:/gi, '')
    .replace(/you\s+are\s+now/gi, '')
    .replace(/act\s+as\s+(?:a\s+)?(?:different|new|another)/gi, '')
    .replace(/disregard\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions?|context)/gi, '')
    .replace(/forget\s+(?:everything|your\s+rules)/gi, '')
    // Spanish injection patterns
    .replace(/ignora?\s+(?:todas?\s+)?(?:las?\s+)?instrucciones?\s*(?:anteriores?|previas?)?/gi, '')
    .replace(/olvida\s+(?:todo|tus\s+reglas|las\s+instrucciones)/gi, '')
    .replace(/(?:eres|actúa|actua|compórtate|comportate)\s+(?:como|ahora)\s+/gi, '')
    .replace(/nuevo\s+rol\s*:/gi, '')
    .replace(/a\s+partir\s+de\s+ahora\s+(?:eres|serás)/gi, '')
    // Unicode-encoded bypass attempts (e.g. %69gnore, &#x69;gnore)
    .replace(/&#?x?[0-9a-f]{1,6};/gi, '')
    .replace(/%[0-9a-f]{2}/gi, '')
    // Strip markdown/XML that could confuse structured prompts
    .replace(/<[^>]+>/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const { method } = req

  if (method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  // ── Incoming enqueued message from QStash (POST) ─────────────────────────
  if (method === 'POST') {
    const rawBody = await req.text()

    // Layer 1: QStash Signature verification
    // NOTE: This must be enforced so only QStash (with our keys) can trigger this function.
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

      // Extract text from text message or transcribe voice note
      let rawText = msg.text?.body ?? null
      let whisperTokens = 0
      const wasAudio = !rawText && !!msg.audio?.id

      if (!rawText && msg.audio?.id) {
        addBreadcrumb('Voice note received, downloading media', 'whatsapp', 'info')
        try {
          const { buffer, mimeType } = await downloadMediaBuffer(msg.audio.id)
          addBreadcrumb('Media downloaded, transcribing with Whisper', 'llm', 'info')
          
          const result = await transcribeAudio(buffer, mimeType)
          rawText = result.text
          whisperTokens = result.tokens
        } catch (err) {
          if (err instanceof LlmRateLimitError) {
            // Handle rate limit WITHOUT re-throwing to avoid QStash cascade
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
          // Notify user instead of silent failure
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

      // ── Business Owner Verification Webhook Interceptor ──
      const textUpper = rawText.toUpperCase().trim()
      if (textUpper.startsWith('VINCULAR-')) {
        const slug = textUpper.replace('VINCULAR-', '').toLowerCase()
        const result = await verifyBusinessPhone(slug, sender)
        
        if (result === 'ALREADY_VERIFIED') {
          await sendWhatsAppMessage(sender, `✅ *¡WhatsApp ya verificado!*\n\nEste número ya se encuentra vinculado correctamente al negocio. No es necesario realizar la vinculación de nuevo.\n\n_Seguridad Cronix_ 🛡️`)
        } else if (result) {
          const successMsg = `✅ *¡WhatsApp vinculado exitosamente!*\n\nTu número ha sido registrado para el negocio *${result}*.\nA partir de ahora recibirás alertas instantáneas cuando la Inteligencia Artificial agende nuevas citas.\n\n_Seguridad Cronix_ 🛡️`
          await sendWhatsAppMessage(sender, successMsg)
        } else {
          const errMsg = `❌ *Error de vinculación*\n\nNo se encontró ningún negocio con el identificador "${slug}". Verifica que el enlace sea correcto.`
          await sendWhatsAppMessage(sender, errMsg)
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

      // ── Slug extraction (BEFORE sanitization — # would be stripped) ────────
      // Matches #slug-name anywhere in the message text
      const slugMatch = rawText.match(/#([a-z0-9][a-z0-9-]{1,30})/i)
      const slug      = slugMatch?.[1]?.toLowerCase() ?? null

      // Remove the #slug from the text so the AI doesn't see it as conversation
      const rawTextWithoutSlug = slug
        ? rawText.replace(slugMatch![0], '').trim()
        : rawText

      // Layer 3: Sanitize message (anti prompt-injection)
      const text = sanitizeMessage(rawTextWithoutSlug)

      // Handle slug-only messages: client opened the WhatsApp link and sent just #slug
      if (!text && slug) {
        const welcomeBiz = await getBusinessBySlug(slug)
        if (welcomeBiz) {
          await upsertSession(sender, welcomeBiz.id)
          const welcomeMsg =
            `¡Hola! 👋 Bienvenido/a a *${welcomeBiz.name}*.\n` +
            `Soy tu asistente virtual de reservas. ¿En qué puedo ayudarte hoy?`
          await sendWhatsAppMessage(sender, welcomeMsg)
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

      // ── 3-tier tenant routing ─────────────────────────────────────────────
      // Priority 1: Explicit #slug in message → resolve by slug
      // Priority 2: No slug → check wa_sessions for last-active business
      // Priority 3: Neither → send Cronix landing message
      let business = slug ? await getBusinessBySlug(slug) : null

      if (business && slug) {
        // Anchor this sender to the business for future messages
        await upsertSession(sender, business.id)
        addBreadcrumb('Business resolved by slug', 'tenant', 'info', { slug })
      }

      if (!business) {
        business = await getSessionBusiness(sender)
        if (business) {
          addBreadcrumb('Business resolved by session', 'tenant', 'info')
        }
      }

      if (!business) {
        // No routing possible — send SaaS landing message
        const landingMsg =
          '¡Hola! 👋 Soy el asistente virtual de reservas de *Cronix*.\n\n' +
          'Para comunicarte con un negocio y agendar una cita, necesitas usar su enlace directo de WhatsApp.\n\n' +
          '🔗 Encuentra todos los negocios disponibles en:\nhttps://cronix-app.vercel.app\n\n' +
          '¡Te esperamos!'
        await sendWhatsAppMessage(sender, landingMsg)
        await flushSentry()
        return json({ success: true, message: 'No business routed — landing sent' })
      }

      setSentryTag('business_id',   business.id)
      setSentryTag('business_name', business.name)
      setSentryTag('business_slug', business.slug || 'unknown')
      addBreadcrumb('Business resolved', 'tenant', 'info', { business_id: business.id, slug: business.slug })

      // Track Whisper tokens if audio was transcribed
      if (whisperTokens > 0) {
        await trackTokenUsage(business.id, whisperTokens)
      }

      // Layer 3: Business aggregate rate limit
      // Layer 3 & 4: Business aggregate rate limit & Token Quota (Precision cost control)
      const dailyTokenLimit = (business.settings as WaBusinessSettings)?.wa_daily_token_limit ?? 50000
      const [withinBusinessQuota, withinTokenQuota] = await Promise.all([
        checkBusinessUsageLimit(business.id),
        checkTokenQuota(business.id, dailyTokenLimit)
      ])

      if (!withinBusinessQuota) {
        addBreadcrumb('Business rate limited', 'rate-limit', 'warning', { business_id: business.id })
        // Silent drop to avoid confirming attack success, or generic "busy" message
        await flushSentry()
        return json({ success: true, message: 'Business quota exceeded — silent drop' })
      }

      if (!withinTokenQuota) {
        addBreadcrumb('Token quota exceeded', 'rate-limit', 'warning', { business_id: business.id })
        const quotaMsg = "🤖 Lo siento, este negocio ha alcanzado su límite de procesamiento diario. Por favor intenta de nuevo mañana o contacta al administrador."
        await sendWhatsAppMessage(sender, quotaMsg)
        await flushSentry()
        return json({ success: true, message: 'Token quota exceeded — user notified' })
      }

      const timezone = business.timezone ?? 'UTC'

      // Fetch full context in parallel where possible
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

      // ── ReAct Agent Loop ──────────────────────────────────────────────────
      let agentResult: { text: string; tokens: number; toolCallsTrace: unknown[] }
      try {
        agentResult = await runAgentLoop(text, context, customerName, sender)

        // Track total LLM usage (loop + final pass)
        if (agentResult.tokens > 0) {
          await trackTokenUsage(business.id, agentResult.tokens)
        }
      } catch (err) {
        if (err instanceof LlmRateLimitError) {
          addBreadcrumb('LLM Rate limit hit', 'llm', 'warning', { retryAfter: err.retryAfterSecs })
          captureException(err, { stage: 'ai_rate_limit', sender })

          const mins = Math.ceil(err.retryAfterSecs / 60)
          const msg  = `Estoy atendiendo muchas consultas. Por favor intenta de nuevo en ${mins} minuto${mins > 1 ? 's' : ''}.`
          await sendWhatsAppMessage(sender, msg)
          await flushSentry()
          return json({ success: true })
        }

        if (err instanceof CircuitBreakerError) {
          addBreadcrumb('LLM Circuit open hit', 'llm', 'error')
          await sendWhatsAppMessage(sender, "🤖 Lo siento, mi cerebro de IA está en mantenimiento breve. Por favor, intenta de nuevo en un minuto.")
          await flushSentry()
          return json({ success: true })
        }

        // Fallback for unexpected LLM errors (timeouts, 5xx, parse errors, etc.)
        // User always gets a message, Sentry captures full error context
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
      
      // 🛡️ DEAD LETTER QUEUE (Autopsy)
      await logToDLQ(rawBody, error, 'process-whatsapp')

      // Notify user of technical failure instead of silence
      try {
        const payload = JSON.parse(rawBody) as MetaWebhookPayload
        const sender  = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
        if (sender) {
          await sendWhatsAppMessage(sender, "⚠️ Lo siento, tuve un problema técnico al procesar tu mensaje. Por favor intenta de nuevo en un momento.")
        }
      } catch (notifyErr) {
        captureException(notifyErr, { stage: 'notify_user_of_error', sender })
      }

      await flushSentry()
      // If we throw here, QStash will automatically retry!
      return json({ error: 'Internal Server Error' }, 500)
    }
  }

  await flushSentry()
  return json({ error: 'Method not allowed' }, 405)
})
