import type { SupabaseClient } from '@supabase/supabase-js'
import type { ITracer, ITraceSink } from './contracts'
import { Tracer }        from './Tracer'
import { PgTraceSink }   from './PgTraceSink'
import { CompositeSink } from './CompositeSink'
import { LangSmithSink } from './LangSmithSink'
import { logger }        from '@/lib/logger'

export * from './contracts'
export { shortHash }     from './hashing'
export { Tracer }        from './Tracer'
export { PgTraceSink }   from './PgTraceSink'
export { CompositeSink } from './CompositeSink'
export { LangSmithSink } from './LangSmithSink'

export interface TracerDeps {
  readonly supabase: SupabaseClient
}

const LANGSMITH_DEFAULT_ENDPOINT = 'https://api.smith.langchain.com'
const LANGSMITH_DEFAULT_PROJECT  = 'cronix'

/** DI composition root for the Node runtime. */
export function createTracer(deps: TracerDeps): ITracer {
  const sink = buildSink(new PgTraceSink(deps.supabase))
  return new Tracer(sink, () => Date.now(), (stage, error) => {
    logger.warn('TRACER', `degraded at ${stage}`, { error })
  })
}

/**
 * Opt-in LangSmith fan-out. PgTraceSink stays canonical; LangSmith is a
 * best-effort secondary. Absent LANGSMITH_API_KEY → degrade to PgTraceSink.
 */
function buildSink(pg: PgTraceSink): ITraceSink {
  const apiKey = process.env.LANGSMITH_API_KEY
  if (!apiKey) return pg

  const langSmith = new LangSmithSink({
    apiKey,
    endpoint: process.env.LANGSMITH_ENDPOINT ?? LANGSMITH_DEFAULT_ENDPOINT,
    project:  process.env.LANGSMITH_PROJECT  ?? LANGSMITH_DEFAULT_PROJECT,
  })
  return new CompositeSink(pg, [langSmith], (error) =>
    logger.warn('TRACER', 'langsmith sink degraded', { error }),
  )
}
