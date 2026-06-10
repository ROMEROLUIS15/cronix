/**
 * observability-repo.test.ts — Unit tests for ObservabilityRepo.
 *
 * Coverage:
 *   getSummary24h    — aggregates outcomes, sums tokens, computes p50/p95
 *   getTopErrors24h  — groups by error_code, sorts desc, applies limit
 *   getRecentTraces  — orders by created_at desc, maps snake_case → camelCase
 *
 * Mocks the Supabase fluent builder (.from().select().eq().gte()...).
 */

import { describe, it, expect, vi } from 'vitest'
import { ObservabilityRepo } from '@/app/[locale]/dashboard/observability/_data/observability-repo'

function makeBuilder<T>(rows: T[]) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    gte:    vi.fn().mockReturnThis(),
    not:    vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockReturnThis(),
    then:   (resolve: (v: { data: T[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  }
  return builder
}

function makeDb<T>(rows: T[]) {
  return { from: vi.fn(() => makeBuilder(rows)) } as unknown as Parameters<typeof makeRepo>[0]
}

function makeRepo(db: any): ObservabilityRepo {
  return new ObservabilityRepo(db)
}

describe('ObservabilityRepo.getSummary24h', () => {
  it('aggregates outcomes, sums tokens, and ranks latencies', async () => {
    const db = makeDb([
      { outcome: 'success',      total_tokens: 100, latency_ms: 1000 },
      { outcome: 'success',      total_tokens: 200, latency_ms: 1500 },
      { outcome: 'failure',      total_tokens:  50, latency_ms: 3000 },
      { outcome: 'error',        total_tokens:   0, latency_ms: 5000 },
      { outcome: 'rate_limited', total_tokens:   0, latency_ms:  500 },
      { outcome: 'no_action',    total_tokens:   0, latency_ms:  200 },
    ])

    const summary = await makeRepo(db).getSummary24h('biz-1')

    expect(summary.total).toBe(6)
    expect(summary.success).toBe(2)
    expect(summary.failures).toBe(3) // failure + error + rate_limited
    expect(summary.noAction).toBe(1)
    expect(summary.tokens).toBe(350)
    expect(summary.p50Ms).toBe(1500)
    expect(summary.p95Ms).toBe(5000)
  })

  it('returns zeros for empty windows', async () => {
    const summary = await makeRepo(makeDb([])).getSummary24h('biz-1')
    expect(summary).toEqual({
      total: 0, success: 0, failures: 0, noAction: 0, tokens: 0, p50Ms: 0, p95Ms: 0,
    })
  })
})

describe('ObservabilityRepo.getTopErrors24h', () => {
  it('groups by error_code and sorts desc with a limit', async () => {
    const db = makeDb([
      { error_code: 'SLOT_CONFLICT' },
      { error_code: 'SLOT_CONFLICT' },
      { error_code: 'SLOT_CONFLICT' },
      { error_code: 'CLIENT_AMBIGUOUS' },
      { error_code: 'CLIENT_AMBIGUOUS' },
      { error_code: 'BOOKING_RATE_LIMIT' },
      { error_code: null },
    ])

    const errors = await makeRepo(db).getTopErrors24h('biz-1', 2)

    expect(errors).toHaveLength(2)
    expect(errors[0]).toEqual({ code: 'SLOT_CONFLICT',    count: 3 })
    expect(errors[1]).toEqual({ code: 'CLIENT_AMBIGUOUS', count: 2 })
  })

  it('returns [] when there are no errors', async () => {
    expect(await makeRepo(makeDb([])).getTopErrors24h('biz-1')).toEqual([])
  })
})

describe('ObservabilityRepo.getRecentTraces', () => {
  it('maps DB rows to camelCase TraceRow shape', async () => {
    const db = makeDb([{
      id:           't1',
      created_at:   '2026-05-18T10:00:00Z',
      channel:      'whatsapp',
      outcome:      'success',
      latency_ms:   1234,
      total_tokens: 88,
      tools_count:  1,
      error_code:   null,
    }])

    const rows = await makeRepo(db).getRecentTraces('biz-1')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      id:         't1',
      createdAt:  '2026-05-18T10:00:00Z',
      channel:    'whatsapp',
      outcome:    'success',
      latencyMs:  1234,
      tokens:     88,
      toolsCount: 1,
      errorCode:  null,
    })
  })
})
