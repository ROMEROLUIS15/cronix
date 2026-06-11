import { createClient } from '@supabase/supabase-js'
import type { ITracer, ITraceSink } from './contracts.ts'
import { Tracer }        from './Tracer.ts'
import { PgTraceSink }   from './PgTraceSink.ts'
import { CompositeSink } from './CompositeSink.ts'
import { LangSmithSink } from './LangSmithSink.ts'
import { addBreadcrumb } from '../sentry.ts'

export * from './contracts.ts'
export { shortHash }     from './hashing.ts'
export { Tracer }        from './Tracer.ts'
export { PgTraceSink }   from './PgTraceSink.ts'
export { CompositeSink } from './CompositeSink.ts'
export { LangSmithSink } from './LangSmithSink.ts'

const LANGSMITH_DEFAULT_ENDPOINT = 'https://api.smith.langchain.com'
const LANGSMITH_DEFAULT_PROJECT  = 'cronix'

/** DI composition root for the Deno (Edge Function) runtime. */
export function createTracer(): ITracer {
  // @ts-ignore — Deno runtime global
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const db   = createClient(url, key)
  const sink = buildSink(new PgTraceSink(db))

  return new Tracer(sink, () => Date.now(), (stage, error) =>
    addBreadcrumb(`tracer degraded at ${stage}`, 'observability', 'warning', { error }),
  )
}

/**
 * Opt-in LangSmith fan-out. PgTraceSink stays canonical; LangSmith is a
 * best-effort secondary. Absent LANGSMITH_API_KEY → degrade to PgTraceSink.
 */
function buildSink(pg: PgTraceSink): ITraceSink {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('LANGSMITH_API_KEY')
  if (!apiKey) return pg

  const langSmith = new LangSmithSink({
    apiKey,
    // @ts-ignore — Deno runtime global
    endpoint: Deno.env.get('LANGSMITH_ENDPOINT') ?? LANGSMITH_DEFAULT_ENDPOINT,
    // @ts-ignore — Deno runtime global
    project:  Deno.env.get('LANGSMITH_PROJECT') ?? LANGSMITH_DEFAULT_PROJECT,
  })
  return new CompositeSink(pg, [langSmith], (error) =>
    addBreadcrumb('langsmith sink degraded', 'observability', 'warning', { error }),
  )
}
