/**
 * turn-context.ts — Per-turn shared context for the agent pipeline.
 *
 * Builds, once per message, everything the deterministic layers and the LLM loop need:
 * the history window, memory recall + intent classification (in parallel), the
 * constitutional write-guard, and a best-effort trace helper so NO turn is invisible.
 */

import type { BusinessRagContext } from "./types.ts"
import { addBreadcrumb } from "../_shared/sentry.ts"
import { memoryEngine, router, tracer, reviewer } from "./agent-singletons.ts"
import { scrubPII } from "./output-sanitizer.ts"
import { shortHash } from "../_shared/observability/index.ts"
import type { MemoryRecord, MemoryScope } from "../_shared/memory/contracts.ts"
import type { ClassifyResult } from "../_shared/router/contracts.ts"
import { reviewWriteOrFailOpen } from "../_shared/supervisor/index.ts"
import type { WriteGuard } from "./tool-executor.ts"

export type TurnResult = { text: string; tokens: number; toolCallsTrace: unknown[] }

/** Everything the per-turn layers need, built once per message. */
export interface TurnContext {
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

/** Constitutional reviewer wired as a WriteGuard for the LLM write path. */
function buildWriteGuard(
  businessId:   string,
  userText:     string,
  recentMemory: Array<{ content: string; similarity: number; createdAt: string }>,
): WriteGuard | undefined {
  if (!reviewer) return undefined
  const rev = reviewer // narrow once; the closure can't narrow the imported const
  return async (toolName, args) => {
    const outcome = await reviewWriteOrFailOpen({
      reviewer: rev,
      toolName,
      args,
      scope:         { businessId, channel: 'whatsapp' },
      userUtterance: userText,
      recentMemory,
    })
    return outcome.allowed ? null : { blocked: true, reason: outcome.reason }
  }
}

/** Builds the shared per-turn context (history window, memory + intent, guard, tracer). */
export async function buildTurnContext(
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
    business.id, userText,
    recalled.map(r => ({ content: r.content, similarity: r.similarity, createdAt: r.createdAt })),
  )

  addBreadcrumb('Memory recall + intent classification completed', 'agent', 'info', {
    memory_hits: recalled.length,
    intent:      intent?.intent     ?? 'unknown',
    confidence:  intent?.confidence ?? 0,
  })

  return { userText, context, customerName, sender, business, cappedHistory, recalled, intent, memoryScope, writeGuard, quickTrace }
}
