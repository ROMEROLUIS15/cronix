import { createClient } from '@supabase/supabase-js'
import type { ITracer } from './contracts.ts'
import { Tracer }      from './Tracer.ts'
import { PgTraceSink } from './PgTraceSink.ts'
import { addBreadcrumb } from '../sentry.ts'

export * from './contracts.ts'
export { shortHash }   from './hashing.ts'
export { Tracer }      from './Tracer.ts'
export { PgTraceSink } from './PgTraceSink.ts'

/** DI composition root for the Deno (Edge Function) runtime. */
export function createTracer(): ITracer {
  // @ts-ignore — Deno runtime global
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const db   = createClient(url, key)
  const sink = new PgTraceSink(db)

  return new Tracer(sink, () => Date.now(), (stage, error) =>
    addBreadcrumb(`tracer degraded at ${stage}`, 'observability', 'warning', { error }),
  )
}
