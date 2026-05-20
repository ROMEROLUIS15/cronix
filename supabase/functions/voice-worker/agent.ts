/**
 * Agent loop — provider-agnostic.
 *
 * Manual implementation of the OpenAI-compatible tool-calling protocol:
 *   1. Send messages + tool defs to LLM (via the configured provider)
 *   2. If response has tool_calls, execute each, append tool messages
 *   3. Loop until LLM returns plain text (or MAX_STEPS exhausted)
 *
 * Per-turn deduplication: same (toolName + args) blocked. Prevents
 * duplicate bookings if the model loops on the same tool call.
 *
 * Provider selection is env-driven (LLM_PROVIDER):
 *   "groq"        → Groq only (default)
 *   "gemini"      → Gemini only
 *   "gemini,groq" → Gemini primary, Groq fallback on error
 *
 * Required env vars (depending on selection):
 *   LLM_API_KEY     — Groq (comma-separated for key rotation)
 *   GEMINI_API_KEY  — Gemini
 */

import { buildSystemPrompt } from './prompt.ts'
import type { ToolContext }  from './core/tool-context.ts'
import { getProvider }       from './providers/registry.ts'
import type { NeutralMessage, NeutralTool } from './providers/ILLMProvider.ts'
import type { AgentInput, AgentOutput, AppointmentNotification, NotificationType, ToolResult } from './types.ts'
import {
  detectFastPath as registryDetect,
  executeByName,
  getToolDefinitions,
  WRITE_CAPABILITIES,
  BYPASS_CAPABILITIES,
} from './capabilities/_shared/registry.ts'
import { createMemoryEngine }            from '../_shared/memory/index.ts'
import { createConstitutionalReviewer, reviewWriteOrFailOpen } from '../_shared/supervisor/index.ts'
import { createTracer, shortHash }       from '../_shared/observability/index.ts'
import type { TraceOutcome, ToolStepStatus } from '../_shared/observability/contracts.ts'

const memoryEngine = createMemoryEngine()
const reviewer     = createConstitutionalReviewer()
const tracer       = createTracer()

const MAX_STEPS = 3   // 1-2 tool calls + final synthesis fits comfortably

// ── Adapter: capability definitions → neutral provider tool shape ────────
//
// When a capability succeeds and was the sole tool call, the agent bypasses
// the LLM second pass and speaks the tool's `result` directly. Why: Llama
// 3.3 70B Versatile occasionally ignored tool results and synthesised its
// own (wrong) answer. Bypassing eliminates that hallucination surface.
// Industry-standard pattern (LangChain `return_direct=True`, OpenAI tool-use
// docs). The bypass set comes from the registry's `bypassLLM` flag — every
// current capability opts in because their results are already prose.
function toNeutralTools(): NeutralTool[] {
  return getToolDefinitions().map(t => ({
    name:        t.function.name,
    description: t.function.description,
    parameters:  t.function.parameters as NeutralTool['parameters'],
  }))
}

// ── Date guard (deterministic override of LLM date arithmetic) ───────────
//
// Llama 3.3 70B Versatile — even with extremely explicit imperative prompts
// listing "MAÑANA: <date>" — sometimes still passes today's date when the
// user says "mañana". This is a documented model weakness in numeric
// reasoning that prompt engineering can't fully eliminate.
//
// Solution: trust the model for INTENT (which tool to call, who to mention)
// but override its DATE selection with deterministic logic when we detect
// known temporal keywords in the user input. The LLM proposes, our code
// disposes.

/** Tools whose args include a `date: YYYY-MM-DD` field we can guard. */
const DATE_TOOLS = new Set([
  'get_appointments_by_date',
  'get_available_slots',
  'smart_schedule',
  'cancel_booking',
  'reschedule_booking',
])

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

interface DateOverride {
  date:    string
  reason:  string
}

/**
 * Inspects the user's text for temporal keywords ("hoy", "mañana", "pasado
 * mañana") and returns the canonical date. Order matters: "pasado mañana"
 * must be checked BEFORE "mañana" because the latter is a substring of
 * the former.
 *
 * Returns null when no recognized keyword is present (LLM keeps its date).
 */
function detectTemporalIntent(userText: string, today: string): DateOverride | null {
  const t = userText.toLowerCase()
  // Word-boundary regexes so "Manaña" inside another word doesn't trigger.
  const PASADO_MANANA = /\bpasado\s+ma[ñn]ana\b/
  const MANANA        = /\bma[ñn]ana\b/
  const HOY           = /\bhoy\b/

  if (PASADO_MANANA.test(t)) return { date: addDaysIso(today, 2), reason: '"pasado mañana"' }
  if (MANANA.test(t))        return { date: addDaysIso(today, 1), reason: '"mañana"' }
  if (HOY.test(t))           return { date: today,                reason: '"hoy"' }
  return null
}

// ── Notification building (post-write side effect) ───────────────────────

const ACTION_TO_EVENT_TYPE: Record<string, NotificationType> = {
  created:     'appointment.created',
  cancelled:   'appointment.cancelled',
  rescheduled: 'appointment.rescheduled',
}

// ── Public API ────────────────────────────────────────────────────────────

export async function runAgent(
  ctx:   ToolContext,
  input: AgentInput,
): Promise<AgentOutput> {
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })

  // Per-turn observability trace. Closed at every exit path below so the
  // dashboard (/dashboard/observability) sees voice turns alongside whatsapp.
  const trace = tracer.start(
    { businessId: ctx.businessId, channel: 'voice-worker', actorKind: 'user', actorKey: ctx.userId },
    await shortHash(input.text),
    { timezone: ctx.timezone },
  )

  // ── Constitutional guard: attach a LAZY write-guard closure to ctx.
  //    Memory recall (~150–300 ms: embedding + pgvector) used to run on
  //    EVERY turn before the fast-path branch. Read-only intents
  //    ("próxima cita", "qué citas tengo hoy") never invoke the guard, so
  //    the recall was pure latency tax. We now defer the recall until the
  //    FIRST write attempt, memoise it for the rest of the turn, and skip
  //    it entirely on read-only turns.
  //
  //    Memory recall is mandatory by design (guard.ts asserts the array
  //    shape) — never pass undefined; an empty array means "tried and
  //    found nothing" while a deferred fetch means "we haven't asked yet".
  if (reviewer) {
    let memoryPromise: Promise<Array<{ content: string; similarity: number; createdAt: string }>> | null = null
    const ensureMemory = () => {
      if (!memoryPromise) {
        memoryPromise = memoryEngine.recall(
          { businessId: ctx.businessId, actorKind: 'user', actorKey: ctx.userId },
          input.text,
          { topK: 5, threshold: 0.78 },
        ).then(recalled => recalled.map(r => ({
          content:    r.content,
          similarity: r.similarity,
          createdAt:  r.createdAt,
        })))
      }
      return memoryPromise
    }
    ctx = {
      ...ctx,
      runWriteGuard: async (toolName, args): Promise<ToolResult | null> => {
        const recentMemory = await ensureMemory()
        const outcome = await reviewWriteOrFailOpen({
          reviewer,
          toolName,
          args,
          scope:         { businessId: ctx.businessId, channel: 'voice' },
          userUtterance: input.text,
          recentMemory,
        })
        if (outcome.allowed) return null
        return {
          success: false,
          result:  `No puedo ejecutar esa acción: ${outcome.reason}`,
        }
      },
    }
  }

  // ── FAST PATHS — total LLM bypass for unambiguous queries
  //
  // The user's input text is unambiguous enough that we can answer correctly
  // without involving the LLM. Eliminates every class of LLM-induced bug:
  // wrong date math, hallucinated tool args, ignored tool results, looping.

  // Registry-backed fast paths. Remaining intents still go through the
  // inline detectors below until their capabilities migrate.
  const fastPathLastRef = input.lastRef
    ? { ...input.lastRef, setAt: Date.now() }
    : null
  const registryHit = registryDetect({
    text:     input.text,
    today:    todayLocal,
    timezone: ctx.timezone,
    history:  input.history,
    lastRef:  fastPathLastRef,
    services: input.context.services,
  })
  if (registryHit) {
    console.log(`[VOICE-WORKER-AGENT] FAST PATH (${registryHit.capability.name}): args=${JSON.stringify(registryHit.args)}`)
    const fastStart = Date.now()
    const result = await executeByName(registryHit.capability.name, registryHit.args, ctx)
    trace.recordToolCall({
      tool:            registryHit.capability.name,
      durationMs:      Date.now() - fastStart,
      status:          result.success ? 'success' : 'error',
      argsFingerprint: await shortHash(JSON.stringify(registryHit.args)),
      errorCode:       result.success ? undefined : 'FAST_PATH_FAILURE',
    })
    // Tools may set fallthroughToLLM=true when they can't resolve a client by
    // the STT-mangled name and the LLM (with the activeClients roster in
    // context) has a better chance at mapping it. Skip the fast-path bypass
    // and let the LLM branch below take the turn.
    if (result.fallthroughToLLM) {
      console.log(`[VOICE-WORKER-AGENT] FAST PATH (${registryHit.capability.name}) → falling through to LLM (not_found)`)
    } else {
    const text = result.success
      ? result.result
      : (result.result || 'No pude completar esa consulta en este momento. Intenta de nuevo.')
    const newHistory: AgentOutput['history'] = [
      ...input.history,
      { role: 'user',      content: input.text },
      { role: 'assistant', content: text       },
    ].slice(-30)
    // Write tools called via fast path: surface their data so the session
    // captures the new lastRef (skip cancellations — the appointment is
    // gone so anaphoric follow-ups would be nonsense) and emit the bell
    // notification the LLM path also emits. The LLM-path branch below
    // mirrors this exact logic; both paths must stay in lock-step so the
    // dashboard refreshes on every successful write regardless of route.
    const fastPathNotifications: AppointmentNotification[] = []
    let fastPathLastRefCandidate: AgentOutput['lastRefCandidate'] = null
    if (registryHit.capability.isWrite && result.success && result.data) {
      const eventType = ACTION_TO_EVENT_TYPE[result.data.action]
      if (eventType) {
        fastPathNotifications.push({
          eventId:     crypto.randomUUID(),
          type:        eventType,
          businessId:  ctx.businessId,
          userId:      ctx.userId,
          clientName:  result.data.clientName,
          serviceName: result.data.serviceName,
          date:        result.data.date,
          time:        result.data.time,
        })
      }
      fastPathLastRefCandidate = result.data.action === 'cancelled'
        ? null
        : {
            appointmentId: result.data.appointmentId,
            clientName:    result.data.clientName,
            serviceName:   result.data.serviceName,
            date:          result.data.date,
            time:          result.data.time,
          }
    }
    const fastOutcome: TraceOutcome = result.success
      ? (registryHit.capability.isWrite ? 'success' : 'no_action')
      : 'failure'
    await trace.finish({
      outcome:      fastOutcome,
      finalTextSha: await shortHash(text),
    })
    return {
      text,
      actionPerformed:      registryHit.capability.isWrite && result.success,
      history:              newHistory,
      modelUsed:            `fast-path/${registryHit.capability.name}`,
      pendingNotifications: fastPathNotifications,
      lastRefCandidate:     fastPathLastRefCandidate,
    }
    }
  }

  // ── Normal LLM flow (everything else) ─────────────────────────────────
  const provider = getProvider()
  const tools    = toNeutralTools()
  const system   = buildSystemPrompt(input)

  // Pre-compute the user's temporal intent ONCE for this turn. If the user
  // said "hoy" / "mañana" / "pasado mañana", we'll use this to override the
  // LLM's date selection on any tool call that takes a `date` arg.
  const dateOverride    = detectTemporalIntent(input.text, todayLocal)

  // Conversation history → neutral messages
  const messages: NeutralMessage[] = [
    ...input.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: input.text },
  ]

  // Per-turn dedup of (toolName + canonical args JSON)
  const executedFingerprints = new Set<string>()
  let actionPerformed         = false
  const pendingNotifications: AppointmentNotification[] = []
  let modelUsed               = 'unknown'
  let finalText               = ''
  let lastRefCandidate: AgentOutput['lastRefCandidate'] = null

  for (let step = 0; step < MAX_STEPS; step++) {
    const llmStart = Date.now()
    const resp = await provider.chat({
      system,
      messages,
      tools,
      temperature:     0.1,
      maxOutputTokens: 400,
    })
    modelUsed = resp.modelUsed
    trace.recordLlmStep({
      model:        resp.modelUsed,
      latencyMs:    Date.now() - llmStart,
      tokens:       resp.tokensUsed,
      hadToolCalls: resp.toolCalls.length > 0,
    })

    // No tool calls → final response
    if (resp.toolCalls.length === 0) {
      finalText = (resp.content ?? '').trim()
      messages.push({ role: 'assistant', content: finalText })
      break
    }

    // Append the assistant turn (with tool_calls) — required by the protocol
    messages.push({
      role:       'assistant',
      content:    resp.content,
      tool_calls: resp.toolCalls,
    })

    // Track results from this step so we can decide whether to bypass synthesis.
    // We capture the tool's result text whether it succeeded or not — every
    // tool in BYPASS_CAPABILITIES returns user-facing prose on both branches, so
    // bypassing on failure preserves the tool's own error message (e.g.
    // "¿A qué hora?") instead of letting the LLM rewrite or ignore it.
    let lastResultText:    string | null = null
    let successfulCallCount = 0

    // Execute each tool call
    for (const tc of resp.toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>
      } catch {
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      'Error: argumentos inválidos (no es JSON válido).',
        })
        continue
      }

      // ── Date guard ─────────────────────────────────────────────────────
      // If the user said "hoy" / "mañana" / "pasado mañana" but the LLM
      // emitted a different `date`, override it. This is the only way to
      // make the assistant's date math reliable on Llama 3.x — the prompt
      // alone doesn't bind it strongly enough.
      if (dateOverride && DATE_TOOLS.has(tc.name) && typeof parsedArgs.date === 'string') {
        const llmDate = parsedArgs.date as string
        if (llmDate !== dateOverride.date) {
          console.warn(
            `[VOICE-WORKER-AGENT] Date guard: user said ${dateOverride.reason} ` +
            `but LLM passed date=${llmDate} → overriding to ${dateOverride.date}`,
          )
          parsedArgs.date = dateOverride.date
        }
      }

      // Stable fingerprint with sorted keys
      const sortedArgs = Object.keys(parsedArgs).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = parsedArgs[k]; return acc
      }, {})
      const fp = `${tc.name}::${JSON.stringify(sortedArgs)}`

      if (executedFingerprints.has(fp)) {
        console.warn(`[VOICE-WORKER-AGENT] Duplicate tool call blocked: ${tc.name}`)
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      'Esta acción ya fue ejecutada en este turno con los mismos datos. NO la repitas. Sintetiza el resultado anterior y termina.',
        })
        continue
      }
      executedFingerprints.add(fp)

      const toolStart = Date.now()
      const result = await executeByName(tc.name, parsedArgs, ctx)
      const toolStatus: ToolStepStatus = result.success ? 'success' : 'error'
      trace.recordToolCall({
        tool:            tc.name,
        durationMs:      Date.now() - toolStart,
        status:          toolStatus,
        argsFingerprint: await shortHash(JSON.stringify(sortedArgs)),
        errorCode:       result.success ? undefined : 'TOOL_FAILURE',
      })
      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        name:         tc.name,
        content:      result.result,
      })

      if (result.success) successfulCallCount++
      if (BYPASS_CAPABILITIES.has(tc.name) && result.result) {
        lastResultText = result.result
      }

      if (result.success && WRITE_CAPABILITIES.has(tc.name)) {
        actionPerformed = true
        if (result.data) {
          const eventType = ACTION_TO_EVENT_TYPE[result.data.action]
          if (eventType) {
            pendingNotifications.push({
              eventId:     crypto.randomUUID(),
              type:        eventType,
              businessId:  ctx.businessId,
              userId:      ctx.userId,
              clientName:  result.data.clientName,
              serviceName: result.data.serviceName,
              date:        result.data.date,
              time:        result.data.time,
            })
          }
          // Capture the most recent appointment so the next turn can resolve
          // anaphoric "reagéndala" / "cancélala" without forcing the user to
          // name the client again. Cancellations also count — they update
          // the conversation's frame of reference.
          if (result.data.action !== 'cancelled') {
            lastRefCandidate = {
              appointmentId: result.data.appointmentId,
              clientName:    result.data.clientName,
              serviceName:   result.data.serviceName,
              date:          result.data.date,
              time:          result.data.time,
            }
          } else {
            // After a cancel we deliberately clear lastRef — the appointment
            // is gone, so anaphoric follow-ups would be nonsense.
            lastRefCandidate = null
          }
        }
      }
    }

    // ── Bypass LLM synthesis when the tool returned prose ─────────────────
    // Industry-standard pattern (LangChain `return_direct`, OpenAI function-
    // calling docs). Use the tool's output directly instead of asking the
    // LLM to rephrase. Bypass on BOTH success and failure for tools whose
    // failure result is also user-facing prose ("¿A qué hora?", "Hay varios
    // clientes similares: …") — otherwise Llama 3.x will rewrite or
    // outright ignore the tool's question and book against bad data anyway.
    if (
      resp.toolCalls.length === 1 &&
      lastResultText &&
      BYPASS_CAPABILITIES.has(resp.toolCalls[0]!.name)
    ) {
      finalText = lastResultText
      console.log(`[VOICE-WORKER-AGENT] Bypassing LLM synthesis — using ${resp.toolCalls[0]!.name} result directly (success=${successfulCallCount === 1})`)
      break
    }
  }

  // Safety net for empty responses after a successful action
  if (!finalText.trim() && actionPerformed) {
    finalText = 'Listo.'
  } else if (!finalText.trim()) {
    finalText = 'No te entendí bien, ¿puedes repetir?'
  }

  // Build clean history (only user + final assistant text — drop tool messages)
  const newHistory: AgentOutput['history'] = [
    ...input.history,
    { role: 'user',      content: input.text },
    { role: 'assistant', content: finalText  },
  ].slice(-30)

  const llmOutcome: TraceOutcome = actionPerformed
    ? 'success'
    : (finalText.trim() ? 'success' : 'no_action')
  await trace.finish({
    outcome:      llmOutcome,
    finalTextSha: await shortHash(finalText),
  })

  return {
    text:                 finalText,
    actionPerformed,
    history:              newHistory,
    modelUsed,
    pendingNotifications,
    lastRefCandidate,
  }
}
