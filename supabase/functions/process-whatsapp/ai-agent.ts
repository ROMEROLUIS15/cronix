/**
 * AI Agent for Appointment Scheduling — ReAct Loop Architecture
 *
 * Implements a multi-step reasoning loop (ReAct pattern) using Native JSON Tool Calling.
 *
 * Architecture:
 *  - Small model (llama-3.1-8b-instant) handles the decision/tool-calling loop (MAX_STEPS=3)
 *  - Large model (llama-3.3-70b-versatile) generates the final empathetic response
 *  - If DB rejects a booking (SLOT_CONFLICT), the LLM sees the error and self-corrects
 *
 * Exposes:
 *  - runAgentLoop    → ReAct loop: reasons, calls tools, returns final text
 *  - transcribeAudio → Groq Whisper STT
 *
 * Module map:
 *  - groq-client.ts   → LLM types, callLlm(), heliconeHeaders(), error classes
 *  - prompt-builder.ts → buildMinimalSystemPrompt(), renderBookingSuccessTemplate()
 *  - tool-executor.ts  → BOOKING_TOOLS, executeToolCall()
 *  - notifications.ts  → fireOwnerNotifications(), sendWhatsAppWithRetry()
 */

import type { BusinessRagContext, ActiveAppointmentRow } from "./types.ts"
import { addBreadcrumb, captureException } from "../_shared/sentry.ts"
import {
  checkCircuitBreaker,
  reportServiceFailure,
  reportServiceSuccess,
} from "./guards.ts"
import {
  callLlm,
  LlmRateLimitError,
  CircuitBreakerError,
  SMALL_MODEL,
  MAX_STEPS,
} from "./groq-client.ts"
import type { AgentMessage } from "./groq-client.ts"
import { buildMinimalSystemPrompt, renderBookingSuccessTemplate } from "./prompt-builder.ts"
import { BOOKING_TOOLS, executeToolCall }                         from "./tool-executor.ts"
import { toolsAllowedThisTurn } from "./confirmation-gate.ts"
import { createMemoryEngine }   from "../_shared/memory/index.ts"
import type { MemoryRecord, MemoryScope } from "../_shared/memory/contracts.ts"
import { createTracer, shortHash } from "../_shared/observability/index.ts"
import type { TraceOutcome, ToolStepStatus } from "../_shared/observability/contracts.ts"
import { createSemanticRouter } from "../_shared/router/index.ts"
import type { ClassifyResult }  from "../_shared/router/contracts.ts"

// Single instance per cold start. Stateless — safe to share across requests.
const memoryEngine = createMemoryEngine()
const tracer       = createTracer()
const router       = createSemanticRouter()

export { LlmRateLimitError, CircuitBreakerError }

// ── Output Sanitization ────────────────────────────────────────────────────────

const TOOL_NAME_ALTERNATION = '(?:confirm|cancel|reschedule)_booking'

function sanitizeOutput(text: string): string {
  if (!text) return text
  return text
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/<function>[\s\S]*?<\/function>/gi, '')
    .replace(/\[CONFIRM_[^\]]+\]/gi, '')
    .replace(/\{[\s\S]*?"(?:service_id|client_id|appointment_id|date|time)":[\s\S]*?\}/gi, '')
    // Strip plaintext tool invocations leaking through when tool_choice is 'none'
    .replace(new RegExp(`\\b${TOOL_NAME_ALTERNATION}\\s*\\([^)]*\\)`, 'gi'), '')
    .replace(new RegExp(`\\b${TOOL_NAME_ALTERNATION}\\s*[:=]\\s*\\{[^}]*\\}`, 'gi'), '')
    .replace(new RegExp(`\\b${TOOL_NAME_ALTERNATION}\\b`, 'gi'), '')
    // Collapse whitespace left behind
    .replace(/\s+/g, ' ')
    .trim()
}

function containsInternalSyntax(text: string): boolean {
  // Bare UUIDs leaked by the 8B when the confirmation gate blocks tool access
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim())) return true
  return new RegExp(`<function[=\\s>]|CONFIRM_|"service_id"|"client_id"|"appointment_id"|\\b${TOOL_NAME_ALTERNATION}\\b`, 'i').test(text)
}

const INTERNAL_SYNTAX_FALLBACK = 'Estoy verificando la información. ¿Podrías confirmarme?'

// Tool-gating helpers are in confirmation-gate.ts (imported above).

// ── Deterministic intent fallback ─────────────────────────────────────────────
// Used ONLY when the 8B produces empty/unusable output while the gate is blocked.
// Builds the clarification/confirmation question directly from DB state so the
// client always receives a specific, correct answer even if the model fails.

const CANCEL_INTENT_RE     = /\b(cancel(?:a|ar|o|en|ame|alo)?|anul(?:a|ar)?|borrar?)\b/i
const RESCHEDULE_INTENT_RE = /\b(reagend(?:a|ar|ame|alo)?|reprogram(?:a|ar|ame)?|mover|mueve|cambia(?:r)?\s+(?:mi\s+)?(?:cita|hora|fecha))\b/i

function formatApt(apt: ActiveAppointmentRow, timezone: string): { dateStr: string; timeStr: string } {
  const dt      = new Date(apt.start_at)
  const dateStr = dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: timezone })
  const timeStr = dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
  return { dateStr, timeStr }
}

function buildDeterministicIntentResponse(
  userText:           string,
  activeAppointments: ActiveAppointmentRow[],
  timezone:           string,
): string | null {
  const cancelIntent     = CANCEL_INTENT_RE.test(userText)
  const rescheduleIntent = RESCHEDULE_INTENT_RE.test(userText)

  if (!cancelIntent && !rescheduleIntent) return null

  if (activeAppointments.length === 0) {
    return 'No veo ninguna cita activa a tu nombre. ¿Quieres agendar una nueva?'
  }

  if (activeAppointments.length === 1) {
    const apt = activeAppointments[0]!
    const { dateStr, timeStr } = formatApt(apt, timezone)
    if (cancelIntent) {
      return `¿Confirmas que cancele tu cita de *${apt.service_name}* del ${dateStr} a las ${timeStr}?`
    }
    return `¿Para qué nueva fecha y hora te gustaría reagendar tu cita de *${apt.service_name}* del ${dateStr} a las ${timeStr}?`
  }

  const list = activeAppointments.slice(0, 5).map((apt, i) => {
    const { dateStr, timeStr } = formatApt(apt, timezone)
    return `${i + 1}. *${apt.service_name}* — ${dateStr} a las ${timeStr}`
  }).join('\n')

  const verb = cancelIntent ? 'cancelar' : 'reagendar'
  return `Tienes varias citas activas:\n\n${list}\n\n¿Cuál de ellas quieres ${verb}?`
}

// ── Public API: Agent Loop ────────────────────────────────────────────────────

/**
 * Runs the ReAct agent loop for a WhatsApp message.
 *
 * Inner loop (SMALL_MODEL): decides whether to call a booking tool, executes it,
 * feeds the DB result back to the LLM, and retries if needed (up to MAX_STEPS).
 *
 * Final pass (LARGE_MODEL): generates an empathetic, on-brand response for the customer.
 *
 * @param userText     - Sanitized message text from the customer
 * @param context      - Full BusinessRagContext (services, history, booked slots, etc.)
 * @param customerName - Display name from WhatsApp
 * @param sender       - WhatsApp phone number (used for booking payload)
 */
export async function runAgentLoop(
  userText:     string,
  context:      BusinessRagContext,
  customerName: string,
  sender:       string,
): Promise<{ text: string; tokens: number; toolCallsTrace: unknown[] }> {
  const { business } = context

  // Cap history at 14 messages (~7 turns) for much better memory
  const cappedHistory = context.history.slice(-14)

  // ── Memory recall + intent classification (parallel, both degrade gracefully)
  const memoryScope: MemoryScope = {
    businessId: business.id,
    actorKind:  'client_phone',
    actorKey:   sender,
  }
  const [recalled, intent] = await Promise.all([
    memoryEngine.recall(memoryScope, userText, { topK: 5, threshold: 0.78 }),
    router.classify(userText),
  ])

  addBreadcrumb('Memory recall + intent classification completed', 'agent', 'info', {
    memory_hits: recalled.length,
    intent:      intent?.intent     ?? 'unknown',
    confidence:  intent?.confidence ?? 0,
  })

  // ── Open the per-turn trace (closed in the finally block below) ───────────
  const trace = tracer.start(
    { businessId: business.id, channel: 'whatsapp', actorKind: 'client_phone', actorKey: sender },
    await shortHash(userText),
    {
      memory_hits:      recalled.length,
      intent:           intent?.intent     ?? null,
      intent_confidence: intent?.confidence ?? null,
    },
  )

  // Build initial messages array
  const messages: AgentMessage[] = [
    { role: 'system', content: buildMinimalSystemPrompt(context, customerName, recalled, intent) },
    // Inject conversation history (convert 'model' role to 'assistant')
    ...cappedHistory.map(h => ({
      role:    (h.role === 'model' ? 'assistant' : h.role) as AgentMessage['role'],
      content: h.text,
    })),
    { role: 'user', content: userText },
  ]

  // Deterministic 2-turn gate: tools only become callable when the prior
  // assistant turn was a "¿Confirmo...?" and the user answered affirmatively.
  // When blocked, we pass an empty tools array so the model does not see the
  // tool schemas at all — removes the hallucination surface entirely.
  const toolsAllowed       = toolsAllowedThisTurn(cappedHistory, userText)
  const activeTools        = toolsAllowed ? BOOKING_TOOLS : []
  const toolChoice: 'auto' | 'none' = 'auto'

  let totalTokens:    number    = 0
  let step:           number    = 0
  let actionPerformed = false
  let loopText:       string    = ''
  const toolCallsTrace: unknown[] = []

  // Deduplication guard: blocks the LLM from calling the same tool with identical
  // arguments twice in a single turn, which would create duplicate appointments.
  const executedToolFingerprints = new Set<string>()

  // ── ReAct Loop (SMALL_MODEL) ──────────────────────────────────────────────
  while (step < MAX_STEPS) {
    step++

    addBreadcrumb(`ReAct loop step ${step}/${MAX_STEPS}`, 'agent', 'info', {
      model:    SMALL_MODEL,
      business: business.name,
    })

    const llmStart = Date.now()
    const { response, tokens } = await callLlm(
      SMALL_MODEL,
      messages,
      activeTools,
      { tenant: business.slug ?? 'unknown', customer: customerName, loop_step: String(step) },
      false,
      toolChoice,
    )
    totalTokens += tokens

    const assistantMsg = response.choices?.[0]?.message
    trace.recordLlmStep({
      model:        SMALL_MODEL,
      latencyMs:    Date.now() - llmStart,
      tokens,
      hadToolCalls: Boolean(assistantMsg?.tool_calls?.length),
    })
    if (!assistantMsg) break

    // ── Embedded function recovery ─────────────────────────────────────────
    // Only attempt to promote leaked text into a real tool_call when the gate
    // allows it. Otherwise we'd be executing exactly the hallucinations the gate
    // is supposed to block.
    if (toolsAllowed && assistantMsg.content && (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0)) {
      const match1 = assistantMsg.content.match(/<function=([a-z_]+)>([\s\S]*?)<\/function>/i)
      const match2 = assistantMsg.content.match(/<function>\s*([a-z_]+)\s*<\/function>\s*(\{[\s\S]*\})/i)
      let fnName = ''
      let argsRaw = ''
      
      if (match1) { fnName = match1[1] ?? ''; argsRaw = match1[2] ?? '' }
      else if (match2) { fnName = match2[1] ?? ''; argsRaw = match2[2] ?? '' }

      if (fnName) {
        addBreadcrumb(`LLM emitted embedded <function> syntax — recovering ${fnName}`, 'agent', 'warning')
        const VALID_TOOL_NAMES = new Set(['confirm_booking', 'reschedule_booking', 'cancel_booking'])
        let argsValid = false
        try { JSON.parse(argsRaw); argsValid = true } catch { /* malformed JSON — skip recovery */ }

        if (argsValid && VALID_TOOL_NAMES.has(fnName)) {
          assistantMsg.tool_calls = [{
            id:       `call_${Date.now()}`,
            type:     'function',
            function: {
              name:      fnName as 'confirm_booking' | 'reschedule_booking' | 'cancel_booking',
              arguments: argsRaw,
            },
          }]
          // Hide leaked content from LLM
          assistantMsg.content = null
        } else {
          loopText = INTERNAL_SYNTAX_FALLBACK
          break
        }
      }
    }

    // Add assistant turn to history (include tool_calls if present — required by API)
    messages.push({
      role:       'assistant',
      content:    assistantMsg.content ?? null,
      tool_calls: assistantMsg.tool_calls,
    })

    // No tool calls → LLM finished reasoning, capture text and break
    if (!assistantMsg.tool_calls?.length) {
      loopText = assistantMsg.content?.trim() ?? ''
      break
    }

    actionPerformed = true

    // Execute each tool call and feed results back
    for (const toolCall of assistantMsg.tool_calls) {
      const stepStart = Date.now()

      // Deduplication guard — same tool + same args in the same session = duplicate booking risk
      const fingerprint = `${toolCall.function.name}::${toolCall.function.arguments}`
      if (executedToolFingerprints.has(fingerprint)) {
        addBreadcrumb(`Duplicate tool call blocked: ${toolCall.function.name}`, 'agent', 'warning')
        messages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          name:         toolCall.function.name,
          content:      JSON.stringify({ success: false, error: 'DUPLICATE_CALL: esta acción ya fue ejecutada en este turno' }),
        })
        continue
      }
      executedToolFingerprints.add(fingerprint)

      let toolResult: string
      try {
        toolResult = await executeToolCall(toolCall, context, sender, customerName)
      } catch (err) {
        captureException(err, { stage: 'execute_tool_call', tool: toolCall.function.name })
        toolResult = JSON.stringify({ success: false, error: 'TOOL_EXECUTION_ERROR: error interno al ejecutar la acción' })
      }

      const parsedResult = (() => { try { return JSON.parse(toolResult) } catch { return toolResult } })()

      const toolSuccess = parsedResult?.success !== false
      toolCallsTrace.push({
        step,
        tool:        toolCall.function.name,
        args:        (() => { try { return JSON.parse(toolCall.function.arguments) } catch { return toolCall.function.arguments } })(),
        result:      parsedResult,
        duration_ms: Date.now() - stepStart,
        success:     toolSuccess,
      })

      const toolStatus: ToolStepStatus =
        toolSuccess ? 'success'
        : String(parsedResult?.error ?? '').includes('RATE_LIMIT') ? 'rate_limited'
        : 'error'

      trace.recordToolCall({
        tool:            toolCall.function.name,
        durationMs:      Date.now() - stepStart,
        status:          toolStatus,
        argsFingerprint: await shortHash(toolCall.function.arguments),
        errorCode:       toolSuccess ? undefined : String(parsedResult?.error ?? 'UNKNOWN').slice(0, 64),
      })

      messages.push({
        role:         'tool',
        tool_call_id: toolCall.id,
        name:         toolCall.function.name,
        content:      toolResult,
      })
    }
  }

  // Detect loop exhaustion: hit MAX_STEPS while still executing tools (no clean break)
  const loopExhausted = step === MAX_STEPS && actionPerformed && !loopText

  if (loopExhausted) {
    captureException(
      new Error(`ReAct loop exhausted after ${MAX_STEPS} steps`),
      {
        stage:           'loop_exhausted',
        business_id:     business.id,
        steps_taken:     step,
        tools_attempted: (toolCallsTrace as Array<{ tool: string }>).map(t => t.tool).join(' → '),
      }
    )
    addBreadcrumb('Loop exhausted — escalating to LARGE_MODEL', 'agent', 'warning')
  }

  addBreadcrumb(`ReAct loop completed in ${step} step(s)`, 'agent', 'info', {
    total_tokens_so_far: totalTokens,
    action_performed:    actionPerformed,
    loop_exhausted:      loopExhausted,
  })

  // ── Final Pass (LARGE_MODEL): empathetic response ─────────────────────────
  // Only invoked when tools were executed (booking actions need on-brand confirmation)
  // or when the loop exited without generating any text (edge case: MAX_STEPS hit).
  // Pure conversational messages answered by the 8B skip this to save tokens.
  let finalText: string

  // Check if last tool call succeeded — if so, skip LARGE_MODEL entirely using template
  const lastToolMsg    = [...messages].reverse().find(m => m.role === 'tool')
  const lastToolParsed = lastToolMsg ? (() => { try { return JSON.parse(lastToolMsg.content ?? '') } catch { return null } })() : null
  const lastTrace      = toolCallsTrace[toolCallsTrace.length - 1] as { tool: string } | undefined

  if (actionPerformed && lastToolParsed?.success === true) {
    // Tool succeeded → use predefined template, skip LLM entirely.
    // Runs even if loop exhausted: a successful last action is still a valid outcome.
    finalText = renderBookingSuccessTemplate(
      lastTrace?.tool ?? '',
      lastToolParsed,
      business.timezone,
    )
    addBreadcrumb('Skipped final LLM pass (success template used)', 'agent', 'info', { tool: lastTrace?.tool, loop_exhausted: loopExhausted })

    // Fire-and-forget: persist the episode. Never awaited inside the response path.
    void memoryEngine.write(memoryScope, {
      kind:    'episodic',
      content: `Cliente ${customerName}: ${lastTrace?.tool ?? 'acción'} — ${userText}`,
      metadata: {
        tool:   lastTrace?.tool,
        result: lastToolParsed,
      },
      ttlDays: 180,
    })
  } else if (actionPerformed && lastToolParsed?.success === false) {
    // Tool failed with a known error — return deterministic message, NO second LLM call
    // A second LLM call here is the root cause of the 400→circuit breaker→503 loop
    const errorCode = String(lastToolParsed?.error ?? '')
    if (errorCode.includes('SLOT_CONFLICT') || errorCode.includes('Slot no disponible')) {
      finalText = '⚠️ Ese horario ya está ocupado. ¿Te gustaría intentar con otra fecha u hora disponible?'
    } else if (errorCode.includes('BOOKING_RATE_LIMIT')) {
      finalText = '⚠️ Has alcanzado el límite de citas nuevas por hoy. Por favor contáctanos directamente si necesitas agendar con urgencia.'
    } else if (errorCode.includes('INVALID_ARGS')) {
      finalText = '⚠️ Hubo un problema con los datos de la cita. Por favor indícame nuevamente el servicio, fecha y hora.'
    } else if (errorCode.includes('UNAUTHORIZED') || errorCode.includes('NOT_FOUND')) {
      finalText = '⚠️ No encontré esa cita en tu historial. ¿Puedes confirmarme los detalles?'
    } else {
      finalText = '⚠️ No pude procesar tu solicitud en este momento. Por favor intenta de nuevo en unos minutos.'
    }
    addBreadcrumb('Tool failed — using deterministic error response', 'agent', 'warning', { errorCode })
  } else if (!loopText) {
    // No tool call, empty text: LLM produced nothing useful.
    // Graceful fallback that invites the customer to clarify — better UX than a cold error.
    addBreadcrumb('Empty loop response without action — asking customer to clarify', 'agent', 'warning', { loop_exhausted: loopExhausted })
    finalText = '¿Podrías indicarme con más detalle qué te gustaría hacer? Estoy aquí para ayudarte.'
  } else {
    // 8B already produced a complete conversational response — use it directly
    finalText = loopText
    addBreadcrumb('Using direct 8B conversational response', 'agent', 'info')
  }

  addBreadcrumb('Agent loop finished', 'agent', 'info', { total_tokens: totalTokens, steps: step })

  finalText = sanitizeOutput(finalText)
  if (!finalText || finalText.trim() === '' || containsInternalSyntax(finalText)) {
    addBreadcrumb('Empty text or internal syntax detected after sanitization — using fallback', 'agent', 'warning', {
      snippet: finalText?.slice(0, 100)
    })
    // Prefer a DB-driven, intent-aware response over the generic fallback so the
    // client always sees the actual appointment details when they ask to cancel
    // or reschedule — no matter what the 8B produced.
    const deterministic = !toolsAllowed
      ? buildDeterministicIntentResponse(userText, context.activeAppointments, business.timezone)
      : null
    finalText = deterministic ?? INTERNAL_SYNTAX_FALLBACK
  }

  // ── Close the trace (awaited — Edge runtime may terminate after return) ───
  const lastFailedError = lastToolParsed?.success === false
    ? String(lastToolParsed?.error ?? '')
    : ''
  const outcome: TraceOutcome = (() => {
    if (loopExhausted)                                          return 'error'
    if (actionPerformed && lastToolParsed?.success === true)    return 'success'
    if (lastFailedError.includes('RATE_LIMIT'))                 return 'rate_limited'
    if (actionPerformed && lastToolParsed?.success === false)   return 'failure'
    if (!actionPerformed && !loopText)                          return 'no_action'
    return 'success'
  })()

  await trace.finish({
    outcome,
    errorCode:    lastFailedError ? lastFailedError.slice(0, 64) : undefined,
    finalTextSha: await shortHash(finalText),
  })

  return { text: finalText, tokens: totalTokens, toolCallsTrace }
}

// ── Public API: Audio Transcription ───────────────────────────────────────────

/**
 * Transcribes a voice note buffer to text using Groq Whisper.
 *
 * @param buffer   - Raw audio bytes (ogg/mp4/webm — whatever Meta sends)
 * @param mimeType - MIME type from Meta (e.g. 'audio/ogg; codecs=opus')
 */
export async function transcribeAudio(buffer: ArrayBuffer, mimeType: string): Promise<{ text: string | null; tokens: number }> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('DEEPGRAM_AURA_API_KEY') ?? Deno.env.get('DEEPGRAM_API_KEY')
  if (!apiKey) throw new Error('DEEPGRAM_AURA_API_KEY no configurada')

  const serviceName = 'DEEPGRAM_STT'
  if (!(await checkCircuitBreaker(serviceName))) {
    throw new CircuitBreakerError(serviceName)
  }

  addBreadcrumb('Calling Deepgram Nova-2 API for STT', 'llm', 'info', { mimeType, byteLength: buffer.byteLength })

  // Deepgram supports raw binary payloads via fetch natively.
  let res: Response
  try {
    res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      body: buffer
    })
  } catch (err) {
    await reportServiceFailure(serviceName)
    throw err
  }

  // Single retry for transient 5xx server errors. Rate-limit (429) and client errors (4xx) are not retried.
  if (!res.ok && res.status >= 500) {
    addBreadcrumb(`Deepgram API ${res.status} on first attempt — retrying once`, 'llm', 'warning')
    try {
      res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': mimeType,
        },
        body: buffer
      })
    } catch (retryErr) {
      await reportServiceFailure(serviceName)
      throw retryErr
    }
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
  }

  if (!res.ok) {
    const errBody = await res.text()
    addBreadcrumb(`Deepgram STT error ${res.status}: ${errBody.slice(0, 200)}`, 'llm', 'error', { status: res.status })
    if (res.status >= 500) await reportServiceFailure(serviceName)
    const err = new Error(`Deepgram ${res.status}: ${errBody}`);
    (err as Error & { bufferData?: string }).bufferData = `Len: ${buffer.byteLength}`;
    throw err
  }

  await reportServiceSuccess(serviceName)

  const data = await res.json()
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  const estimatedTokens = transcript ? 50 + transcript.split(/\s+/).length : 0

  return { text: transcript || null, tokens: estimatedTokens }
}

