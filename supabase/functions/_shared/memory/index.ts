import { createClient } from '@supabase/supabase-js'
import type { IMemoryEngine } from './contracts.ts'
import { SupabaseEdgeEmbedder }  from './Embedder.ts'
import { PgVectorEpisodicStore } from './EpisodicStore.ts'
import { MemoryEngine }          from './MemoryEngine.ts'
import { addBreadcrumb }         from '../sentry.ts'

export * from './contracts.ts'
export { SupabaseEdgeEmbedder }  from './Embedder.ts'
export { PgVectorEpisodicStore } from './EpisodicStore.ts'
export { MemoryEngine }          from './MemoryEngine.ts'

/** DI composition root for the Deno (Edge Function) runtime. */
export function createMemoryEngine(): IMemoryEngine {
  // @ts-ignore — Deno runtime global
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const db = createClient(url, key)

  return new MemoryEngine(
    new SupabaseEdgeEmbedder(`${url}/functions/v1/embed-text`, key),
    new PgVectorEpisodicStore(db),
    (stage, error) =>
      addBreadcrumb(`memory degraded at ${stage}`, 'memory', 'warning', { error }),
  )
}
