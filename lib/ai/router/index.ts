import type { ISemanticRouter, IntentPrototype, IEmbedder } from './contracts'
import { SemanticRouter } from './SemanticRouter'
import { SupabaseEdgeEmbedder } from '@/lib/ai/memory/Embedder'
import { logger } from '@/lib/logger'
import embeddings from './intent-embeddings.generated.json'

export * from './contracts'
export { SemanticRouter } from './SemanticRouter'
export { INTENT_DEFINITIONS } from './intents'

export interface SemanticRouterDeps {
  readonly supabaseUrl:        string
  readonly supabaseServiceKey: string
  readonly embedder?:          IEmbedder
}

/** DI composition root for the Node runtime. */
export function createSemanticRouter(deps: SemanticRouterDeps): ISemanticRouter {
  const prototypes = loadPrototypes()

  const embedder = deps.embedder ?? new SupabaseEdgeEmbedder(
    `${deps.supabaseUrl}/functions/v1/embed-text`,
    deps.supabaseServiceKey,
  )

  return new SemanticRouter(embedder, prototypes, (stage, error) => {
    logger.warn('ROUTER', `degraded at ${stage}`, { error })
  })
}

function loadPrototypes(): ReadonlyArray<IntentPrototype> {
  const raw = embeddings as { prototypes?: unknown }
  if (!Array.isArray(raw.prototypes)) return []
  return raw.prototypes as IntentPrototype[]
}
