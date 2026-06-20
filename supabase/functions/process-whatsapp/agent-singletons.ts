/**
 * agent-singletons.ts — Cold-start singletons shared across the agent modules.
 *
 * One instance per isolate. Stateless and safe to share across requests. Centralised
 * here so every module (pipeline, react-loop, deterministic-write, turn-context)
 * depends on the SAME instances without ai-agent.ts having to thread them through.
 */

import { createMemoryEngine }            from "../_shared/memory/index.ts"
import { createTracer }                  from "../_shared/observability/index.ts"
import { createSemanticRouter }          from "../_shared/router/index.ts"
import { createConstitutionalReviewer }  from "../_shared/supervisor/index.ts"

export const memoryEngine = createMemoryEngine()
export const tracer       = createTracer()
export const router       = createSemanticRouter()
export const reviewer     = createConstitutionalReviewer()
