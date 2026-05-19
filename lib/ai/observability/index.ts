import type { SupabaseClient } from '@supabase/supabase-js'
import type { ITracer } from './contracts'
import { Tracer }      from './Tracer'
import { PgTraceSink } from './PgTraceSink'
import { logger }      from '@/lib/logger'

export * from './contracts'
export { shortHash }    from './hashing'
export { Tracer }       from './Tracer'
export { PgTraceSink }  from './PgTraceSink'

export interface TracerDeps {
  readonly supabase: SupabaseClient
}

/** DI composition root for the Node runtime. */
export function createTracer(deps: TracerDeps): ITracer {
  const sink = new PgTraceSink(deps.supabase)
  return new Tracer(sink, () => Date.now(), (stage, error) => {
    logger.warn('TRACER', `degraded at ${stage}`, { error })
  })
}
