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
import { resolveBookingTurn } from "./booking-flow.ts"
import type { WorkingHours } from "./availability.ts"
import { isListAppointmentsQuery, buildAppointmentsListResponse } from "./read-intents.ts"
import { recoverEmbeddedToolCall } from "./tool-recovery.ts"
import { FAQ_INTENTS, buildFaqResponse } from "./faq-responses.ts"
import { isCancelIntent, isRescheduleIntent, isBookIntent } from "./intents.ts"
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
    // Strip leaked catalog identifiers: the 8B sometimes echoes the prompt's
    // "Servicio … | REF#<uuid>" line verbatim. Drop the "| REF#uuid" tail first,
    // then any bare UUID still in prose. The REF# id must never reach the client.
    .replace(/\s*\|\s*(?:REF#?\s*)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\bREF#?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
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

// ── Observability capture (scrubbed conversation + decision provenance) ─────────
// ai_traces only stored hashes of the message/reply, so silent wrong behaviour
// (outcome=success but the agent booked the wrong date) was invisible. We now store
// the scrubbed turn text + the path that produced it in trace metadata, so a human
// (or an automated check) can see WHAT happened, not just that it "succeeded".

/** Redacts phone numbers and bearer tokens; keeps dates/times intact for debugging. */
function scrubPII(text: string): string {
  if (!text) return ''
  return text
    .replace(/\+?\d{7,}/g, '[PHONE]')          // 7+ consecutive digits = phone (dates have '-', times ':')
    .replace(/Bearer\s+[\w.\-]+/gi, '[TOKEN]')
    .slice(0, 1000)
}

// A confirmation proposal carrying a date+time. After the deterministic redesign the
// LLM must NEVER emit one of these — if it does, it's a hallucination to catch.
const BOOKING_PROPOSAL_DETECT_RE = /¿\s*confirmo\s+tu\s+cita\s+de[\s\S]+para\s+el[\s\S]+a\s+las\s+/i

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
  const cancelIntent     = isCancelIntent(userText)
  const rescheduleIntent = isRescheduleIntent(userText)

  // Booking intent recovery: when the 8B failed to produce a usable reply for a
  // booking turn, ask for the missing data deterministically instead of looping
  // on the "Estoy verificando la información" fallback.
  if (!cancelIntent && !rescheduleIntent && isBookIntent(userText)) {
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
  userText:     string,
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
    function: { name: toolName as ToolCall['function']['name'], arguments: argsJson },
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
    metadata: {
      queryText: scrubPII(userText),
      finalText: scrubPII(finalText),
      path:      'deterministic_write',
      // The booking decision — visible in the trace so a wrong date/time is auditable.
      booking:   { tool: toolName, ...args, source: 'client-stated' },
    },
  })

  return {
    text:   finalText,
    tokens: 0,
    toolCallsTrace: [{ step: 1, tool: toolName, args, result: parsed, duration_ms: Date.now() - stepStart, success }],
  }
}

// ── Per-turn pipeline (orchestrator + layers) ─────────────────────────────────

type TurnResult = { text: string; tokens: number; toolCallsTrace: unknown[] }

/** Everything the per-turn layers need, built once per message. */
interface TurnContext {
  userText:      string
  context:       BusinessRagContext
  customerName:  string
  sender:        string
  business:      BusinessRagContext['business']
  cappedHistory: BusinessRagContext['history']
  recalled:      ReadonlyArray<MemoryRecord>
  intent:        ClassifyResult | null
  memoryScope:   MemoryScope
  writeGuard:    WriteGuard | undefined
  quickTrace:    (finalText: string, path: string, extra?: Record<string, unknown>) => Promise<void>
}

/** Builds the shared per-turn context: history window, memory recall + intent
 *  classification (parallel), the constitutional guard, and the trace helper. */
async function buildTurnContext(
  userText: string, context: BusinessRagContext, customerName: string, sender: string,
): Promise<TurnContext> {
  const { business } = context
  const cappedHistory = context.history.slice(-14) // ~7 turns

  const memoryScope: MemoryScope = { businessId: business.id, actorKind: 'client_phone', actorKey: sender }

  // Every turn (including the 0-token deterministic ones) emits a trace with the
  // scrubbed conversation text + path, so no turn is ever invisible. Best-effort.
  const traceScope = {
    businessId: business.id, channel: 'whatsapp' as const,
    actorKind: 'client_phone' as const, actorKey: sender,
  }
  const quickTrace = async (finalText: string, path: string, extra: Record<string, unknown> = {}): Promise<void> => {
    try {
      const t = tracer.start(traceScope, await shortHash(userText), { path })
      await t.finish({
        outcome: 'success',
        finalTextSha: await shortHash(finalText),
        metadata: { queryText: scrubPII(userText), finalText: scrubPII(finalText), path, ...extra },
      })
    } catch { /* observability is best-effort */ }
  }

  const [recalled, intent] = await Promise.all([
    memoryEngine.recall(memoryScope, userText, { topK: 5, threshold: 0.78 }),
    router.classify(userText),
  ])

  const writeGuard = buildWriteGuard(
    reviewer, business.id, userText,
    recalled.map(r => ({ content: r.content, similarity: r.similarity, createdAt: r.createdAt })),
  )

  addBreadcrumb('Memory recall + intent classification completed', 'agent', 'info', {
    memory_hits: recalled.length,
    intent:      intent?.intent     ?? 'unknown',
    confidence:  intent?.confidence ?? 0,
  })

  return { userText, context, customerName, sender, business, cappedHistory, recalled, intent, memoryScope, writeGuard, quickTrace }
}

// ── Deterministic pipeline layers (each: a TurnResult, or null to pass on) ─────

/** FAQ fast-path: high-confidence info/greeting intents bypass the LLM entirely. */
async function layerFaq(tc: TurnContext): Promise<TurnResult | null> {
  const { intent, context } = tc
  if (!(intent && intent.confidence >= 0.90 && FAQ_INTENTS.has(intent.intent))) return null
  const text = buildFaqResponse(intent.intent, context)
  await tc.quickTrace(text, 'faq', { intent: intent.intent })
  return { text, tokens: 0, toolCallsTrace: [] }
}

/** Deterministic booking state machine (anti-hallucination WRITE path). */
async function layerBooking(tc: TurnContext): Promise<TurnResult | null> {
  const { userText, context, customerName, sender, business, cappedHistory, intent, memoryScope } = tc
  const bookingTurn = resolveBookingTurn({
    userText,
    history:      cappedHistory,
    services:     context.services.map(s => ({ id: s.id, name: s.name, duration_min: s.duration_min })),
    workingHours: (business.settings as { workingHours?: unknown } | null | undefined)?.workingHours as WorkingHours,
    timezone:     business.timezone,
    bookedSlots:  (context.bookedSlots ?? []).map(s => ({ start_at: s.start_at, end_at: s.end_at })),
    activeAppointments: context.activeAppointments.map(a => ({ id: a.id, service_name: a.service_name, start_at: a.start_at })),
    intent:       intent?.intent ?? null,
  })
  if (bookingTurn?.kind === 'reply') {
    addBreadcrumb('Deterministic booking/cancel/reschedule proposal (0 tokens)', 'agent', 'info', { intent: intent?.intent ?? 'unknown' })
    await tc.quickTrace(bookingTurn.text, 'deterministic_booking', {
      isProposal: BOOKING_PROPOSAL_DETECT_RE.test(bookingTurn.text),
      intent: intent?.intent ?? null,
    })
    return { text: bookingTurn.text, tokens: 0, toolCallsTrace: [] }
  }
  if (bookingTurn) {
    // narrowed to an execute directive (the reply case returned above)
    return await executeDeterministicWrite(bookingTurn, context, sender, customerName, memoryScope, userText)
  }
  return null
}

/** Deterministic read: "¿tengo alguna cita?" answered from active appointments. */
async function layerListAppointments(tc: TurnContext): Promise<TurnResult | null> {
  const { userText, context, business } = tc
  if (!isListAppointmentsQuery(userText)) return null
  const text = buildAppointmentsListResponse(context.activeAppointments, business.timezone)
  addBreadcrumb('Deterministic list-appointments resolved (0 tokens)', 'agent', 'info', { count: context.activeAppointments.length })
  await tc.quickTrace(text, 'deterministic_list', { count: context.activeAppointments.length })
  return { text, tokens: 0, toolCallsTrace: [] }
}

/** Fallback: the ReAct LLM loop (SMALL_MODEL) + deterministic final pass. */
async function runReActLlm(tc: TurnContext): Promise<TurnResult> {
  const { userText, context, customerName, sender, business, cappedHistory, recalled, intent, memoryScope, writeGuard } = tc

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

  // Anti-hallucination auto-catch: after the deterministic redesign the LLM must
  // NEVER emit a booking proposal with a date+time. If this fires, the deterministic
  // flow failed to own a booking turn — capture it loudly so we catch it without the
  // user reporting it.
  const llmProposedBooking = BOOKING_PROPOSAL_DETECT_RE.test(finalText)
  if (llmProposedBooking) {
    captureException(new Error('LLM emitted a booking proposal (deterministic flow should own this)'), {
      stage: 'llm_proposed_booking', business_id: business.id, snippet: scrubPII(finalText).slice(0, 160),
    })
  }

  await trace.finish({
    outcome,
    errorCode:    lastFailedError ? lastFailedError.slice(0, 64) : undefined,
    finalTextSha: await shortHash(finalText),
    metadata: {
      queryText: scrubPII(userText),
      finalText: scrubPII(finalText),
      path:      'llm',
      llmProposedBooking,
    },
  })

  return { text: finalText, tokens: totalTokens, toolCallsTrace }
}

// ── Public API: Agent Loop (thin orchestrator) ────────────────────────────────

/**
 * Runs one WhatsApp turn. Builds the shared turn context, then dispatches through
 * the deterministic pipeline (FAQ → booking → list-appointments, each 0 LLM tokens);
 * the first layer that resolves the turn wins. If none do, it falls back to the
 * ReAct LLM loop. The final response text is always deterministic (success template,
 * errorCode map, or the 8B reply verbatim) — see runReActLlm.
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
): Promise<TurnResult> {
  const tc = await buildTurnContext(userText, context, customerName, sender)

  // Deterministic pipeline — first non-null result wins (0 LLM tokens).
  // Order matters: a READ query ("¿tengo citas?") is matched before the booking
  // WRITE path so it's never hijacked by a sticky booking context. Safe because
  // isListAppointmentsQuery excludes any message carrying a write verb.
  for (const layer of [layerFaq, layerListAppointments, layerBooking]) {
    const result = await layer(tc)
    if (result) return result
  }

  // Fallback: the ReAct LLM loop.
  return await runReActLlm(tc)
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

