/**
 * AI Agent for Appointment Scheduling — ReAct Loop Architecture
 *
 * Implements a multi-step reasoning loop (ReAct pattern) using Native JSON Tool Calling.
 *
 * Architecture:
 *  - Small model (llama-3.1-8b-instant) handles the decision/tool-calling loop (MAX_STEPS=3)
 *  - Final pass is fully deterministic: success template | errorCode map | 8B loopText verbatim
 *  - If DB rejects a booking (SLOT_CONFLICT), the LLM sees the error and self-corrects
 *
 * Exposes:
 *  - runAgentLoop    → ReAct loop: reasons, calls tools, returns final text
 *  - transcribeAudio → Deepgram Nova-2 STT (model=nova-2&language=es&smart_format=true)
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
import type { AgentMessage, ToolCall } from "./groq-client.ts"
import { buildMinimalSystemPrompt } from "./prompt-builder.ts"
import { BOOKING_TOOLS, executeToolCall }                         from "./tool-executor.ts"
import { toolsAllowedThisTurn, textHasExplicitBookingParams } from "./confirmation-gate.ts"
import { resolveBookingTimeGap } from "./availability.ts"
import { resolveBookingTurn } from "./booking-flow.ts"
import type { WorkingHours } from "./availability.ts"
import { isListAppointmentsQuery, buildAppointmentsListResponse } from "./read-intents.ts"
import { recoverEmbeddedToolCall } from "./tool-recovery.ts"
import { FAQ_INTENTS, buildFaqResponse } from "./faq-responses.ts"
import { selectFinalResponse } from "./final-response.ts"
import { createMemoryEngine }   from "../_shared/memory/index.ts"
import type { MemoryRecord, MemoryScope } from "../_shared/memory/contracts.ts"
import { createTracer, shortHash } from "../_shared/observability/index.ts"
import type { TraceOutcome, ToolStepStatus } from "../_shared/observability/contracts.ts"
import { createSemanticRouter } from "../_shared/router/index.ts"
import type { ClassifyResult }  from "../_shared/router/contracts.ts"
import { createConstitutionalReviewer, reviewWriteOrFailOpen } from "../_shared/supervisor/index.ts"
import type { WriteGuard } from "./tool-executor.ts"

// Single instance per cold start. Stateless — safe to share across requests.
const memoryEngine = createMemoryEngine()
const tracer       = createTracer()
const router       = createSemanticRouter()
const reviewer     = createConstitutionalReviewer()

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

// ── Private helpers ───────────────────────────────────────────────────────────

function buildWriteGuard(
  rev:          typeof reviewer,
  businessId:   string,
  userText:     string,
  recentMemory: Array<{ content: string; similarity: number; createdAt: string }>,
): WriteGuard | undefined {
  if (!rev) return undefined
  return async (toolName, args) => {
    const outcome = await reviewWriteOrFailOpen({
      reviewer:      rev,
      toolName,
      args,
      scope:         { businessId, channel: 'whatsapp' },
      userUtterance: userText,
      recentMemory,
    })
    return outcome.allowed ? null : { blocked: true, reason: outcome.reason }
  }
}

function trackDedupCall(fingerprints: Set<string>, toolName: string, argsRaw: string): boolean {
  const fp = `${toolName}::${argsRaw}`
  if (fingerprints.has(fp)) return true
  fingerprints.add(fp)
  return false
}

// ── Deterministic intent fallback ─────────────────────────────────────────────
// Used ONLY when the 8B produces empty/unusable output while the gate is blocked.
// Builds the clarification/confirmation question directly from DB state so the
// client always receives a specific, correct answer even if the model fails.

const CANCEL_INTENT_RE     = /\b(cancel(?:a|ar|o|en|ame|alo)?|anul(?:a|ar)?|borrar?)\b/i
const RESCHEDULE_INTENT_RE = /\b(reagend(?:a|ar|ame|alo)?|reprogram(?:a|ar|ame)?|mover|mueve|cambia(?:r)?\s+(?:mi\s+)?(?:cita|hora|fecha))\b/i
const BOOK_INTENT_RE       = /\b(agend(?:a|ar|ame|alo)?|reserv(?:a|ar|ame)?|sacar|pedir|quiero|necesito|nueva)\b.*\bcita\b|\b(agend(?:a|ar|ame|alo)?|reserv(?:a|ar|ame)?)\b/i

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
  services:           ReadonlyArray<{ name: string }> = [],
): string | null {
  const cancelIntent     = CANCEL_INTENT_RE.test(userText)
  const rescheduleIntent = RESCHEDULE_INTENT_RE.test(userText)

  // Booking intent recovery: when the 8B failed to produce a usable reply for a
  // booking turn, ask for the missing data deterministically instead of looping
  // on the "Estoy verificando la información" fallback.
  if (!cancelIntent && !rescheduleIntent && BOOK_INTENT_RE.test(userText)) {
    if (services.length === 1) {
      return `Con gusto te agendo *${services[0]!.name}*. ¿Para qué día y a qué hora te gustaría?`
    }
    return 'Con gusto te ayudo a agendar. ¿Qué servicio te gustaría y para qué día?'
  }

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

// ── Deterministic write execution (book | cancel | reschedule) ──────────────────
// Runs the write tool with code-derived, slot-validated args (the 8B never chose
// them). Reuses executeToolCall so rate-limit, the shared adapter (service ∈ catalog
// + overlap + working-hours validation), the cache invalidation and the notification
// pipeline (owner + bell + push) all fire on the same path as the LLM route. The
// constitutional reviewer (writeGuard) is intentionally skipped: it exists to vet LLM
// hallucinations, and the args here are deterministic, so running it would add an LLM
// call and defeat the 0-token path.

type DeterministicWrite =
  | { kind: 'execute';           serviceId: string;     serviceName: string; date: string;    time: string }
  | { kind: 'executeCancel';     appointmentId: string; serviceName: string; date: string;    time: string }
  | { kind: 'executeReschedule'; appointmentId: string; serviceName: string; newDate: string; newTime: string }

async function executeDeterministicWrite(
  directive:    DeterministicWrite,
  context:      BusinessRagContext,
  sender:       string,
  customerName: string,
  memoryScope:  MemoryScope,
): Promise<{ text: string; tokens: number; toolCallsTrace: unknown[] }> {
  const { business } = context

  // Map the directive to the corresponding write tool + args.
  const { toolName, args } =
    directive.kind === 'execute'
      ? { toolName: 'confirm_booking',    args: { service_id: directive.serviceId, date: directive.date, time: directive.time } }
    : directive.kind === 'executeCancel'
      ? { toolName: 'cancel_booking',     args: { appointment_id: directive.appointmentId } }
      : { toolName: 'reschedule_booking', args: { appointment_id: directive.appointmentId, new_date: directive.newDate, new_time: directive.newTime } }

  const argsJson = JSON.stringify(args)
  const trace = tracer.start(
    { businessId: business.id, channel: 'whatsapp', actorKind: 'client_phone', actorKey: sender },
    await shortHash(`${toolName}|${argsJson}`),
    { deterministic: true, path: 'write_execute', tool: toolName },
  )

  const synthetic: ToolCall = {
    id:       `det_${Date.now()}`,
    type:     'function',
    function: { name: toolName, arguments: argsJson },
  }

  const stepStart = Date.now()
  let toolResult: string
  try {
    toolResult = await executeToolCall(synthetic, context, sender, customerName, undefined)
  } catch (err) {
    captureException(err, { stage: 'deterministic_write', tool: toolName })
    toolResult = JSON.stringify({ success: false, error: 'TOOL_EXECUTION_ERROR' })
  }

  const parsed  = (() => { try { return JSON.parse(toolResult) } catch { return null } })()
  const success = parsed?.success === true
  const errCode = success ? '' : String(parsed?.error ?? '')

  trace.recordToolCall({
    tool:            toolName,
    durationMs:      Date.now() - stepStart,
    status:          success ? 'success' : errCode.includes('RATE_LIMIT') ? 'rate_limited' : 'error',
    argsFingerprint: await shortHash(argsJson),
    errorCode:       success ? undefined : (errCode || 'UNKNOWN').slice(0, 64),
  })

  const finalText = selectFinalResponse(true, parsed, '', { tool: toolName }, business.timezone)

  if (success) {
    void memoryEngine.write(memoryScope, {
      kind:     'episodic',
      content:  `Cliente ${customerName}: ${toolName} — ${directive.serviceName}`,
      metadata: { tool: toolName, result: parsed },
      ttlDays:  180,
    })
  }

  await trace.finish({
    outcome:      success ? 'success' : errCode.includes('RATE_LIMIT') ? 'rate_limited' : 'failure',
    errorCode:    errCode ? errCode.slice(0, 64) : undefined,
    finalTextSha: await shortHash(finalText),
  })

  return {
    text:   finalText,
    tokens: 0,
    toolCallsTrace: [{ step: 1, tool: toolName, args, result: parsed, duration_ms: Date.now() - stepStart, success }],
  }
}

// ── Public API: Agent Loop ────────────────────────────────────────────────────

/**
 * Runs the ReAct agent loop for a WhatsApp message.
 *
 * Inner loop (SMALL_MODEL): decides whether to call a booking tool, executes it,
 * feeds the DB result back to the LLM, and retries if needed (up to MAX_STEPS).
 *
 * Final pass: deterministic — success template, errorCode map, or 8B loopText verbatim.
 * No second LLM call is made at any point.
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

  // Build the constitutional guard for this turn. recentMemory comes from
  // the same recall above — never empty by accident, never a second round-trip.
  const writeGuard = buildWriteGuard(
    reviewer,
    business.id,
    userText,
    recalled.map(r => ({ content: r.content, similarity: r.similarity, createdAt: r.createdAt })),
  )

  addBreadcrumb('Memory recall + intent classification completed', 'agent', 'info', {
    memory_hits: recalled.length,
    intent:      intent?.intent     ?? 'unknown',
    confidence:  intent?.confidence ?? 0,
  })

  // ── Fast Path: FAQ intents with high confidence bypass the LLM entirely ──
  // Avoids burning tokens on small-talk or info queries that have a
  // deterministic, pre-configured answer.
  if (intent && intent.confidence >= 0.90 && FAQ_INTENTS.has(intent.intent)) {
    const text = buildFaqResponse(intent.intent, context)
    return { text, tokens: 0, toolCallsTrace: [] }
  }

  // ── Deterministic booking flow (anti-hallucination, WRITE path) ───────────
  // The 8B never emits service_id/date/time and never proposes a time. When the
  // turn is a recoverable booking moment, resolve it deterministically:
  //   - 'execute' → run confirm_booking with code-derived, slot-validated args.
  //   - 'reply'   → send a validated confirmation question / real free-times list.
  //   - null      → ambiguous; fall through to the time-gap layer and the LLM.
  const bookingTurn = resolveBookingTurn({
    userText,
    history:      cappedHistory,
    services:     context.services.map(s => ({ id: s.id, name: s.name, duration_min: s.duration_min })),
    workingHours: business.settings?.workingHours as unknown as WorkingHours,
    timezone:     business.timezone,
    bookedSlots:  (context.bookedSlots ?? []).map(s => ({ start_at: s.start_at, end_at: s.end_at })),
    activeAppointments: context.activeAppointments.map(a => ({ id: a.id, service_name: a.service_name, start_at: a.start_at })),
    intent:       intent?.intent ?? null,
  })
  if (bookingTurn?.kind === 'reply') {
    addBreadcrumb('Deterministic booking/cancel/reschedule proposal (0 tokens)', 'agent', 'info', { intent: intent?.intent ?? 'unknown' })
    return { text: bookingTurn.text, tokens: 0, toolCallsTrace: [] }
  }
  if (bookingTurn && bookingTurn.kind !== 'reply') {
    return await executeDeterministicWrite(bookingTurn, context, sender, customerName, memoryScope)
  }

  // ── Deterministic availability gap (anti-hallucination) ───────────────────
  // When the client is booking and gave a date but NO time, never let the 8B
  // invent one. Compute the real free slots from working_hours + booked slots
  // and reply deterministically (propose the only slot, list options, or report
  // the day is full). 0 tokens. Booking context = intent OR a prior assistant
  // offer/confirmation so it fires even if the router mislabels the short reply.
  const lastAssistantText = [...cappedHistory].reverse()
    .find(h => h.role === 'model' || h.role === 'assistant')?.text ?? ''
  const isBookingContext =
    intent?.intent === 'book_appointment' ||
    /¿\s*(te\s+gustar[íi]a\s+agendar|quieres\s+agendar|deseas\s+agendar|agendamos|confirmo\s+tu\s+cita|confirmo\s+la\s+cita|a\s+qu[ée]\s+hora)/i.test(lastAssistantText)
  const bookingGap = resolveBookingTimeGap({
    userText,
    isBookingContext,
    services:     context.services.map(s => ({ id: s.id, name: s.name, duration_min: s.duration_min })),
    workingHours: business.settings?.workingHours as unknown as WorkingHours,
    timezone:     business.timezone,
    bookedSlots:  (context.bookedSlots ?? []).map(s => ({ start_at: s.start_at, end_at: s.end_at })),
  })
  if (bookingGap) {
    addBreadcrumb('Deterministic availability gap resolved (0 tokens)', 'agent', 'info', {
      intent: intent?.intent ?? 'unknown',
    })
    return { text: bookingGap, tokens: 0, toolCallsTrace: [] }
  }

  // ── Deterministic read: "¿tengo alguna cita?" ────────────────────────────
  // Answer appointment queries straight from context.activeAppointments instead
  // of letting the 8B echo nonsense. Read-only, 0 tokens.
  if (isListAppointmentsQuery(userText)) {
    const text = buildAppointmentsListResponse(context.activeAppointments, business.timezone)
    addBreadcrumb('Deterministic list-appointments resolved (0 tokens)', 'agent', 'info', {
      count: context.activeAppointments.length,
    })
    return { text, tokens: 0, toolCallsTrace: [] }
  }

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
  // Hybrid Gate: if intent is 'book_appointment' with high confidence and the
  // user text already contains explicit date + time references, open the tool
  // gate directly (skip the confirmation turn). Safety is delegated to the
  // WriteGuard and the domain use-case.
  const canDirectOpen      = intent?.intent === 'book_appointment' && intent.confidence >= 0.90 && textHasExplicitBookingParams(userText)
  const activeTools        = (toolsAllowed || canDirectOpen) ? BOOKING_TOOLS : []
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
      const recovery = recoverEmbeddedToolCall(assistantMsg.content)
      if (recovery) {
        addBreadcrumb(`LLM emitted embedded <function> syntax — recovering ${recovery.name}`, 'agent', 'warning')
        if (recovery.status === 'recovered') {
          assistantMsg.tool_calls = [{
            id:       `call_${Date.now()}`,
            type:     'function',
            function: { name: recovery.name, arguments: recovery.argsRaw },
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
      if (trackDedupCall(executedToolFingerprints, toolCall.function.name, toolCall.function.arguments)) {
        addBreadcrumb(`Duplicate tool call blocked: ${toolCall.function.name}`, 'agent', 'warning')
        messages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          name:         toolCall.function.name,
          content:      JSON.stringify({ success: false, error: 'DUPLICATE_CALL: esta acción ya fue ejecutada en este turno' }),
        })
        continue
      }

      let toolResult: string
      try {
        toolResult = await executeToolCall(toolCall, context, sender, customerName, writeGuard)
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

  // ── Final Pass: pick response text ───────────────────────────────────────────
  const lastToolMsg    = [...messages].reverse().find(m => m.role === 'tool')
  const lastToolParsed = lastToolMsg ? (() => { try { return JSON.parse(lastToolMsg.content ?? '') } catch { return null } })() : null
  const lastTrace      = toolCallsTrace[toolCallsTrace.length - 1] as { tool: string } | undefined

  let finalText = selectFinalResponse(actionPerformed, lastToolParsed, loopText, lastTrace, business.timezone)

  if (actionPerformed && lastToolParsed?.success === true) {
    addBreadcrumb('Skipped final LLM pass (success template used)', 'agent', 'info', { tool: lastTrace?.tool, loop_exhausted: loopExhausted })
    void memoryEngine.write(memoryScope, {
      kind:    'episodic',
      content: `Cliente ${customerName}: ${lastTrace?.tool ?? 'acción'} — ${userText}`,
      metadata: { tool: lastTrace?.tool, result: lastToolParsed },
      ttlDays: 180,
    })
  } else if (actionPerformed && lastToolParsed?.success === false) {
    addBreadcrumb('Tool failed — using deterministic error response', 'agent', 'warning', { errorCode: String(lastToolParsed?.error ?? '') })
  } else if (!loopText) {
    addBreadcrumb('Empty loop response without action — asking customer to clarify', 'agent', 'warning', { loop_exhausted: loopExhausted })
  } else {
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
      ? buildDeterministicIntentResponse(userText, context.activeAppointments, business.timezone, context.services)
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
 * Transcribes a voice note buffer to text using Deepgram Nova-2 STT.
 *
 * Provider note: this path migrated from Groq Whisper to Deepgram (Nova-2 accepts
 * the WebM/ogg-opus audio Meta sends without the EBML header Whisper required).
 * The real call is to api.deepgram.com with DEEPGRAM_AURA_API_KEY.
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

