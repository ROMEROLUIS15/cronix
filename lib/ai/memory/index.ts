import type { SupabaseClient } from '@supabase/supabase-js'
import type { IMemoryEngine } from './contracts'
import { SupabaseEdgeEmbedder }  from './Embedder'
import { PgVectorEpisodicStore } from './EpisodicStore'
import { MemoryEngine }          from './MemoryEngine'
import { logger }                from '@/lib/logger'

export * from './contracts'
export { SupabaseEdgeEmbedder }  from './Embedder'
export { PgVectorEpisodicStore } from './EpisodicStore'
export { MemoryEngine }          from './MemoryEngine'

export interface MemoryEngineDeps {
  readonly supabase:           SupabaseClient
  readonly supabaseUrl:        string
  readonly supabaseServiceKey: string
}

/** DI composition root for the Node runtime. */
export function createMemoryEngine(deps: MemoryEngineDeps): IMemoryEngine {
  const embedder = new SupabaseEdgeEmbedder(
    `${deps.supabaseUrl}/functions/v1/embed-text`,
    deps.supabaseServiceKey,
  )
  const store = new PgVectorEpisodicStore(deps.supabase)

  return new MemoryEngine(embedder, store, (stage, error) => {
    logger.warn('MEMORY', `degraded at ${stage}`, { error })
  })
}
