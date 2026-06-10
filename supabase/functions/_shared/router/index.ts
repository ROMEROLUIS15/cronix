import type { ISemanticRouter, IntentPrototype } from './contracts.ts'
import { SemanticRouter }      from './SemanticRouter.ts'
import { SupabaseEdgeEmbedder } from '../memory/Embedder.ts'
import { addBreadcrumb }       from '../sentry.ts'
import embeddings              from './intent-embeddings.generated.json' with { type: 'json' }

export * from './contracts.ts'
export { SemanticRouter } from './SemanticRouter.ts'

/** DI composition root for the Deno (Edge Function) runtime. */
export function createSemanticRouter(): ISemanticRouter {
  // @ts-ignore — Deno runtime global
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const embedder   = new SupabaseEdgeEmbedder(`${url}/functions/v1/embed-text`, key)
  const prototypes = loadPrototypes()

  return new SemanticRouter(embedder, prototypes, (stage, error) =>
    addBreadcrumb(`router degraded at ${stage}`, 'router', 'warning', { error }),
  )
}

function loadPrototypes(): ReadonlyArray<IntentPrototype> {
  const raw = embeddings as { prototypes?: unknown }
  if (!Array.isArray(raw.prototypes)) return []
  return raw.prototypes as IntentPrototype[]
}
