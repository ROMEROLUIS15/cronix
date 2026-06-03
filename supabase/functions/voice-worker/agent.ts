/**
 * Agent loop — provider-agnostic.
 *
 * Orchestrates the voice turn: fast path detection, constitutional guard, and
 * LLM loop (delegated to voice-pipeline.ts).
 *
 * Provider selection is env-driven (LLM_PROVIDER):
 *   "groq"        → Groq only (default)
 *   "gemini"      → Gemini only
 *   "gemini,groq" → Gemini primary, Groq fallback on error
 */

import { buildSystemPrompt } from './prompt.ts'
import type { ToolContext }  from './core/tool-context.ts'
import { getProvider }       from './providers/registry.ts'
import type { AgentInput, AgentOutput, AppointmentNotification, ToolResult } from './types.ts'
import {
  detectFastPath as registryDetect,
  executeByName,
} from './capabilities/_shared/registry.ts'
import { createMemoryEngine }            from '../_shared/memory/index.ts'
import { createConstitutionalReviewer, reviewWriteOrFailOpen } from '../_shared/supervisor/index.ts'
import { createTracer, shortHash }       from '../_shared/observability/index.ts'
import type { TraceOutcome } from '../_shared/observability/contracts.ts'
import {
  buildVoicePipeline,
  toNeutralTools,
  detectTemporalIntent,
  buildNotificationFromWrite,
} from './voice-pipeline.ts'

const memoryEngine = createMemoryEngine()
const reviewer     = createConstitutionalReviewer()
const tracer       = createTracer()

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
    if (result.fallthroughToLLM) {
      console.log(`[VOICE-WORKER-AGENT] FAST PATH (${registryHit.capability.name}) → falling through to LLM (not_found)`)
    } else {
      return buildFastPathOutput(registryHit, result, input, ctx, trace)
    }
  }

  // ── Normal LLM flow (delegated to pipeline) ─────────────────────────────
  const provider   = getProvider()
  const tools      = toNeutralTools()
  const system     = buildSystemPrompt(input)
  const dateOverride = detectTemporalIntent(input.text, todayLocal)

  const pipeline = buildVoicePipeline()
  const { context: llmResult } = await pipeline.run({
    provider,
    tools,
    system,
    dateOverride,
    ctx,
    input,
    trace,
  })

  const { finalText, actionPerformed, modelUsed, pendingNotifications, lastRefCandidate } = llmResult

  const newHistory: AgentOutput['history'] = [
    ...input.history,
    { role: 'user',      content: input.text },
    { role: 'assistant', content: finalText  },
  ].slice(-30)

  const outcome: TraceOutcome = actionPerformed
    ? 'success'
    : (finalText.trim() ? 'success' : 'no_action')
  await trace.finish({
    outcome,
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

// ── Fast path output builder (shared return path) ─────────────────────────

async function buildFastPathOutput(
  hit:   { capability: { name: string; isWrite: boolean } },
  result: ToolResult,
  input:  AgentInput,
  ctx:    ToolContext,
  trace:  { finish: (opts: { outcome: string; finalTextSha: string }) => Promise<void> },
): Promise<AgentOutput> {
  const text = result.success
    ? result.result
    : (result.result || 'No pude completar esa consulta en este momento. Intenta de nuevo.')

  const newHistory: AgentOutput['history'] = [
    ...input.history,
    { role: 'user',      content: input.text },
    { role: 'assistant', content: text       },
  ].slice(-30)

  const pendingNotifications: AppointmentNotification[] = []
  let lastRefCandidate: AgentOutput['lastRefCandidate'] = null

  if (hit.capability.isWrite && result.success && result.data) {
    const { notification, lastRef } = buildNotificationFromWrite(result, ctx.businessId, ctx.userId)
    if (notification) pendingNotifications.push(notification)
    if (lastRef !== undefined) lastRefCandidate = lastRef
  }

  const fastOutcome: TraceOutcome = result.success
    ? (hit.capability.isWrite ? 'success' : 'no_action')
    : 'failure'
  await trace.finish({
    outcome:      fastOutcome,
    finalTextSha: await shortHash(text),
  })

  return {
    text,
    actionPerformed:      hit.capability.isWrite && result.success,
    history:              newHistory,
    modelUsed:            `fast-path/${hit.capability.name}`,
    pendingNotifications,
    lastRefCandidate,
  }
}
