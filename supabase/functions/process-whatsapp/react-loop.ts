/**
 * react-loop.ts — Fallback ReAct LLM loop (SMALL_MODEL) + deterministic final pass.
 *
 * Reached only when no deterministic layer owned the turn. Reasons, optionally calls a
 * write tool (behind the 2-turn gate), and ALWAYS returns deterministic final text
 * (success template, errorCode map, or the 8B reply verbatim). Decomposed into small
 * single-purpose helpers so no function mixes more than one decision.
 */

import { addBreadcrumb, captureException } from "../_shared/sentry.ts"
import { callLlm, SMALL_MODEL, MAX_STEPS } from "./groq-client.ts"
import type { AgentMessage, ToolCall } from "./groq-client.ts"
import { buildMinimalSystemPrompt } from "./prompt-builder.ts"
import { BOOKING_TOOLS, executeToolCall } from "./tool-executor.ts"
import { toolsAllowedThisTurn, textHasExplicitBookingParams } from "./confirmation-gate.ts"
import { recoverEmbeddedToolCall } from "./tool-recovery.ts"
import { selectFinalResponse } from "./final-response.ts"
import { buildDeterministicIntentResponse } from "./deterministic-intent.ts"
import {
  sanitizeOutput, containsInternalSyntax, INTERNAL_SYNTAX_FALLBACK,
  scrubPII, BOOKING_PROPOSAL_DETECT_RE,
} from "./output-sanitizer.ts"
import { memoryEngine, tracer } from "./agent-singletons.ts"
import { shortHash } from "../_shared/observability/index.ts"
import type { TraceOutcome, ToolStepStatus } from "../_shared/observability/contracts.ts"
import type { TurnContext, TurnResult } from "./turn-context.ts"

type Trace = ReturnType<typeof tracer.start>

// Replacement sent when the LLM leaks a booking proposal: a deterministic re-gather so the
// next turn re-enters the state machine (which owns service/date/time) — never the model's.
const LLM_PROPOSAL_BLOCK_MSG =
  'Para agendar tu cita necesito el servicio, el día y la hora exactos. ¿Me los confirmas, por favor? 😊'

/** Same tool + same args twice in one turn = duplicate booking risk → blocked. */
function isDuplicateCall(seen: Set<string>, toolName: string, argsRaw: string): boolean {
  const fp = `${toolName}::${argsRaw}`
  if (seen.has(fp)) return true
  seen.add(fp)
  return false
}

/** Builds the initial message array: system prompt + history + the user turn. */
function buildMessages(tc: TurnContext): AgentMessage[] {
  return [
    { role: 'system', content: buildMinimalSystemPrompt(tc.context, tc.customerName, tc.recalled, tc.intent) },
    ...tc.cappedHistory.map(h => ({
      role:    (h.role === 'model' ? 'assistant' : h.role) as AgentMessage['role'],
      content: h.text,
    })),
    { role: 'user', content: tc.userText },
  ]
}

/**
 * Deterministic 2-turn gate: tools are callable only when the prior assistant turn was a
 * "¿Confirmo…?" and the user affirmed. Hybrid gate: a high-confidence book intent whose
 * text already carries date+time opens the gate directly. When blocked we pass [] so the
 * model never sees the tool schemas — removing the hallucination surface entirely.
 */
function decideActiveTools(tc: TurnContext): { activeTools: typeof BOOKING_TOOLS | []; toolsAllowed: boolean } {
  const toolsAllowed = toolsAllowedThisTurn(tc.cappedHistory, tc.userText)
  const canDirectOpen = tc.intent?.intent === 'book_appointment'
    && tc.intent.confidence >= 0.90 && textHasExplicitBookingParams(tc.userText)
  return { activeTools: (toolsAllowed || canDirectOpen) ? BOOKING_TOOLS : [], toolsAllowed }
}

/** Executes one tool call, records the trace step and feeds the result back to the model. */
async function executeAndRecordTool(
  toolCall: ToolCall, tc: TurnContext, trace: Trace,
  seen: Set<string>, toolCallsTrace: unknown[], messages: AgentMessage[],
): Promise<void> {
  const stepStart = Date.now()

  if (isDuplicateCall(seen, toolCall.function.name, toolCall.function.arguments)) {
    addBreadcrumb(`Duplicate tool call blocked: ${toolCall.function.name}`, 'agent', 'warning')
    messages.push({
      role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name,
      content: JSON.stringify({ success: false, error: 'DUPLICATE_CALL: esta acción ya fue ejecutada en este turno' }),
    })
    return
  }

  let toolResult: string
  try {
    toolResult = await executeToolCall(toolCall, tc.context, tc.sender, tc.customerName, tc.writeGuard)
  } catch (err) {
    captureException(err, { stage: 'execute_tool_call', tool: toolCall.function.name })
    toolResult = JSON.stringify({ success: false, error: 'TOOL_EXECUTION_ERROR: error interno al ejecutar la acción' })
  }

  const parsedResult = (() => { try { return JSON.parse(toolResult) } catch { return toolResult } })()
  const toolSuccess  = parsedResult?.success !== false
  toolCallsTrace.push({
    step: toolCallsTrace.length + 1,
    tool: toolCall.function.name,
    args: (() => { try { return JSON.parse(toolCall.function.arguments) } catch { return toolCall.function.arguments } })(),
    result: parsedResult, duration_ms: Date.now() - stepStart, success: toolSuccess,
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

  messages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: toolResult })
}

interface LoopOutcome { totalTokens: number; loopText: string; actionPerformed: boolean; step: number; toolsAllowed: boolean }

/** Runs the ReAct step loop, mutating `messages`/`toolCallsTrace`. Returns loop summary. */
async function runSteps(tc: TurnContext, trace: Trace, messages: AgentMessage[], toolCallsTrace: unknown[]): Promise<LoopOutcome> {
  const { activeTools, toolsAllowed } = decideActiveTools(tc)
  const seen = new Set<string>()
  let totalTokens = 0, step = 0, loopText = '', actionPerformed = false

  while (step < MAX_STEPS) {
    step++
    addBreadcrumb(`ReAct loop step ${step}/${MAX_STEPS}`, 'agent', 'info', { model: SMALL_MODEL, business: tc.business.name })

    const llmStart = Date.now()
    const { response, tokens } = await callLlm(
      SMALL_MODEL, messages, activeTools,
      { tenant: tc.business.slug ?? 'unknown', customer: tc.customerName, loop_step: String(step) },
      false, 'auto',
    )
    totalTokens += tokens

    const assistantMsg = response.choices?.[0]?.message
    trace.recordLlmStep({ model: SMALL_MODEL, latencyMs: Date.now() - llmStart, tokens, hadToolCalls: Boolean(assistantMsg?.tool_calls?.length) })
    if (!assistantMsg) break

    // Promote leaked <function> text into a real tool_call ONLY when the gate allows it
    // (otherwise we'd execute exactly the hallucinations the gate is meant to block).
    if (toolsAllowed && assistantMsg.content && !assistantMsg.tool_calls?.length) {
      const recovery = recoverEmbeddedToolCall(assistantMsg.content)
      if (recovery) {
        addBreadcrumb(`LLM emitted embedded <function> syntax — recovering ${recovery.name}`, 'agent', 'warning')
        if (recovery.status === 'recovered') {
          assistantMsg.tool_calls = [{ id: `call_${Date.now()}`, type: 'function', function: { name: recovery.name, arguments: recovery.argsRaw } }]
          assistantMsg.content = null
        } else { loopText = INTERNAL_SYNTAX_FALLBACK; break }
      }
    }

    messages.push({ role: 'assistant', content: assistantMsg.content ?? null, tool_calls: assistantMsg.tool_calls })

    if (!assistantMsg.tool_calls?.length) { loopText = assistantMsg.content?.trim() ?? ''; break }

    actionPerformed = true
    for (const toolCall of assistantMsg.tool_calls) {
      await executeAndRecordTool(toolCall, tc, trace, seen, toolCallsTrace, messages)
    }
  }

  return { totalTokens, loopText, actionPerformed, step, toolsAllowed }
}

/** Picks the final text: success template | errorCode map | 8B reply | deterministic fallback. */
function selectFinalText(
  tc: TurnContext, messages: AgentMessage[], toolCallsTrace: unknown[], loopText: string, actionPerformed: boolean,
  toolsAllowed: boolean,
): { finalText: string; lastToolParsed: { success?: boolean; error?: string } | null } {
  const lastToolMsg    = [...messages].reverse().find(m => m.role === 'tool')
  const lastToolParsed = lastToolMsg ? (() => { try { return JSON.parse(lastToolMsg.content ?? '') } catch { return null } })() : null
  const lastTrace      = toolCallsTrace[toolCallsTrace.length - 1] as { tool: string } | undefined

  let finalText = selectFinalResponse(actionPerformed, lastToolParsed, loopText, lastTrace, tc.business.timezone)

  if (actionPerformed && lastToolParsed?.success === true) {
    void memoryEngine.write(tc.memoryScope, {
      kind: 'episodic', content: `Cliente ${tc.customerName}: ${lastTrace?.tool ?? 'acción'} — ${tc.userText}`,
      metadata: { tool: lastTrace?.tool, result: lastToolParsed }, ttlDays: 180,
    })
  }

  finalText = sanitizeOutput(finalText)
  if (!finalText || finalText.trim() === '' || containsInternalSyntax(finalText)) {
    // Prefer a DB-driven, intent-aware response over the generic fallback.
    const deterministic = !toolsAllowed
      ? buildDeterministicIntentResponse(tc.userText, tc.context.activeAppointments, tc.business.timezone, tc.context.services)
      : null
    finalText = deterministic ?? INTERNAL_SYNTAX_FALLBACK
  }
  return { finalText, lastToolParsed }
}

export async function runReActLlm(tc: TurnContext): Promise<TurnResult> {
  const trace = tracer.start(
    { businessId: tc.business.id, channel: 'whatsapp', actorKind: 'client_phone', actorKey: tc.sender },
    await shortHash(tc.userText),
    { memory_hits: tc.recalled.length, intent: tc.intent?.intent ?? null, intent_confidence: tc.intent?.confidence ?? null },
  )

  const messages = buildMessages(tc)
  const toolCallsTrace: unknown[] = []

  const { totalTokens, loopText, actionPerformed, step, toolsAllowed } = await runSteps(tc, trace, messages, toolCallsTrace)
  const loopExhausted = step === MAX_STEPS && actionPerformed && !loopText
  if (loopExhausted) {
    captureException(new Error(`ReAct loop exhausted after ${MAX_STEPS} steps`), {
      stage: 'loop_exhausted', business_id: tc.business.id, steps_taken: step,
      tools_attempted: (toolCallsTrace as Array<{ tool: string }>).map(t => t.tool).join(' → '),
    })
  }

  const { finalText, lastToolParsed } = selectFinalText(tc, messages, toolCallsTrace, loopText, actionPerformed, toolsAllowed)

  const lastFailedError = lastToolParsed?.success === false ? String(lastToolParsed?.error ?? '') : ''
  const outcome: TraceOutcome = (() => {
    if (loopExhausted)                                        return 'error'
    if (actionPerformed && lastToolParsed?.success === true)  return 'success'
    if (lastFailedError.includes('RATE_LIMIT'))               return 'rate_limited'
    if (actionPerformed && lastToolParsed?.success === false) return 'failure'
    if (!actionPerformed && !loopText)                        return 'no_action'
    return 'success'
  })()

  // Anti-hallucination guard (BLOCKING, not just observing): after the deterministic
  // redesign the LLM must NEVER emit a date+time booking proposal — the deterministic flow
  // owns that. If it leaks here we (1) capture the original for forensics AND (2) REPLACE
  // it so the invented "¿Confirmo… a las…?" never reaches the client; the deterministic
  // gather restarts on the next turn. (The DB write was already protected by re-validation;
  // this closes the cosmetic surface too.)
  const llmProposedBooking = BOOKING_PROPOSAL_DETECT_RE.test(finalText)
  if (llmProposedBooking) {
    captureException(new Error('LLM emitted a booking proposal (deterministic flow should own this)'), {
      stage: 'llm_proposed_booking', business_id: tc.business.id, snippet: scrubPII(finalText).slice(0, 160),
    })
  }
  const textToSend = llmProposedBooking ? LLM_PROPOSAL_BLOCK_MSG : finalText

  await trace.finish({
    outcome,
    errorCode:    lastFailedError ? lastFailedError.slice(0, 64) : undefined,
    finalTextSha: await shortHash(textToSend),
    metadata: { queryText: scrubPII(tc.userText), finalText: scrubPII(textToSend), path: 'llm', llmProposedBooking, blocked: llmProposedBooking },
  })

  return { text: textToSend, tokens: totalTokens, toolCallsTrace }
}
