/**
 * Minimal chainable Supabase mock for capability execution tests.
 *
 * The real supabase-js builder is a thenable that returns `this` from every
 * filter method until a terminal (`.single()` or `await`). This mock records
 * the table, operation type, filters and payloads of each query, then resolves
 * with whatever the test's `responder` returns for that captured op. It lets
 * the execution tests assert "cancel issued an UPDATE status=cancelled on
 * appointments scoped by business_id" without a live database.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CapturedOp {
  table:          string
  type:           'select' | 'insert' | 'update'
  selectArg?:     string
  selectOpts?:    Record<string, unknown>
  insertPayload?: Record<string, unknown>
  updatePayload?: Record<string, unknown>
  eq:             Array<[string, unknown]>
  neq:            Array<[string, unknown]>
  in:             Array<[string, unknown[]]>
  is:             Array<[string, unknown]>
  gt?:            [string, unknown]
  gte?:           [string, unknown]
  lt?:            [string, unknown]
  lte?:           [string, unknown]
  order:          Array<[string, unknown]>
  limit?:         number
  single:         boolean
}

export interface MockResponse {
  data?:  unknown
  error?: { message: string } | null
  count?: number
}

export type Responder = (op: CapturedOp) => MockResponse

export interface MockHandle {
  supabase: SupabaseClient
  ops:      CapturedOp[]
  opsFor:   (table: string) => CapturedOp[]
}

export function createMockSupabase(responder: Responder): MockHandle {
  const ops: CapturedOp[] = []

  const from = (table: string) => {
    const op: CapturedOp = {
      table, type: 'select', eq: [], neq: [], in: [], is: [], order: [], single: false,
    }
    let pushed = false
    const resolve = (): Promise<MockResponse> => {
      if (!pushed) { pushed = true; ops.push(op) }
      return Promise.resolve(responder(op))
    }
    const builder: Record<string, unknown> = {
      select: (arg?: string, opts?: Record<string, unknown>) => { op.selectArg = arg; if (opts) op.selectOpts = opts; return builder },
      insert: (p: Record<string, unknown>) => { op.type = 'insert'; op.insertPayload = p; return builder },
      update: (p: Record<string, unknown>) => { op.type = 'update'; op.updatePayload = p; return builder },
      eq:  (c: string, v: unknown)  => { op.eq.push([c, v]);  return builder },
      neq: (c: string, v: unknown)  => { op.neq.push([c, v]); return builder },
      in:  (c: string, v: unknown[]) => { op.in.push([c, v]); return builder },
      is:  (c: string, v: unknown)  => { op.is.push([c, v]);  return builder },
      gt:  (c: string, v: unknown)  => { op.gt = [c, v];  return builder },
      gte: (c: string, v: unknown)  => { op.gte = [c, v]; return builder },
      lt:  (c: string, v: unknown)  => { op.lt = [c, v];  return builder },
      lte: (c: string, v: unknown)  => { op.lte = [c, v]; return builder },
      order: (c: string, v?: unknown) => { op.order.push([c, v]); return builder },
      limit: (n: number) => { op.limit = n; return builder },
      single:      () => resolve(),
      maybeSingle: () => resolve(),
      then: (onF: (r: MockResponse) => unknown, onR?: (e: unknown) => unknown) => resolve().then(onF, onR),
    }
    return builder
  }

  return {
    supabase: { from } as unknown as SupabaseClient,
    ops,
    opsFor: (table: string) => ops.filter(o => o.table === table),
  }
}
