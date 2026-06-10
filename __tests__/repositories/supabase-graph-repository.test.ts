/**
 * supabase-graph-repository.test.ts — Unit tests for SupabaseGraphRepository.
 *
 * Coverage:
 *   upsertEdge       — happy path, error path, default confidence + metadata
 *   findNeighbors    — happy path, edgeType filter, limit, error path, empty
 *   findInverseEdges — happy path with edgeType filter
 *   removeEdge       — happy path, error path
 *   row → Edge mapping is exercised on every success path
 */

import { describe, it, expect, vi } from 'vitest'
import { SupabaseGraphRepository } from '@/lib/repositories/SupabaseGraphRepository'

// ── Minimal Supabase chainable mock ───────────────────────────────────────────
//
// The repo composes its query via .from().select/upsert/delete().eq/limit/single().
// We expose every chainable verb the repo uses; each one returns the same chain
// object. The terminal step is whatever returns a Promise.

interface ChainResult<T> {
  data:  T | null
  error: { message: string } | null
}

function makeChain<T>(terminal: () => Promise<ChainResult<T>>) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    limit:  vi.fn(() => chain),
    single: vi.fn(() => terminal()),
    then:   (resolve: (v: ChainResult<T>) => void) => terminal().then(resolve),
  }
  return chain
}

function makeSupabase<T>(chainFactory: () => ReturnType<typeof makeChain<T>>) {
  return {
    from: vi.fn(() => chainFactory()),
    // deno-lint-ignore no-explicit-any
  } as any
}

const ROW = {
  id:          'edge-1',
  business_id: 'biz-1',
  from_kind:   'client'   as const,
  from_id:     'cli-A',
  to_kind:     'client'   as const,
  to_id:       'cli-B',
  edge_type:   'aliases_with' as const,
  confidence:  0.9,
  metadata:    { source: 'consolidator' },
  created_at:  '2026-05-20T10:00:00Z',
  expires_at:  null,
}

describe('SupabaseGraphRepository.upsertEdge', () => {
  it('returns a mapped Edge on success', async () => {
    const chain   = makeChain(async () => ({ data: ROW, error: null }))
    const repo    = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result  = await repo.upsertEdge('biz-1', {
      from:     { kind: 'client', id: 'cli-A' },
      to:       { kind: 'client', id: 'cli-B' },
      edgeType: 'aliases_with',
      confidence: 0.9,
      metadata:   { source: 'consolidator' },
    })
    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      id:         'edge-1',
      businessId: 'biz-1',
      from:       { kind: 'client', id: 'cli-A' },
      to:         { kind: 'client', id: 'cli-B' },
      edgeType:   'aliases_with',
      confidence: 0.9,
      metadata:   { source: 'consolidator' },
      createdAt:  '2026-05-20T10:00:00Z',
      expiresAt:  null,
    })
  })

  it('upserts with onConflict targeting the unique scope', async () => {
    const chain = makeChain(async () => ({ data: ROW, error: null }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    await repo.upsertEdge('biz-1', {
      from: { kind: 'client', id: 'cli-A' },
      to:   { kind: 'client', id: 'cli-B' },
      edgeType: 'aliases_with',
    })
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-1',
        from_kind: 'client',
        from_id:   'cli-A',
        to_kind:   'client',
        to_id:     'cli-B',
        edge_type: 'aliases_with',
        confidence: 1,
        metadata:   {},
        expires_at: null,
      }),
      { onConflict: 'business_id,from_kind,from_id,to_kind,to_id,edge_type' },
    )
  })

  it('returns fail when Supabase reports an error', async () => {
    const chain = makeChain(async () => ({ data: null, error: { message: 'duplicate key' } }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.upsertEdge('biz-1', {
      from: { kind: 'client', id: 'a' }, to: { kind: 'client', id: 'b' }, edgeType: 'aliases_with',
    })
    expect(result.data).toBeNull()
    expect(result.error).toContain('upsertEdge')
    expect(result.error).toContain('duplicate key')
  })

  it('returns fail when response is empty without an explicit error', async () => {
    const chain = makeChain(async () => ({ data: null, error: null }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.upsertEdge('biz-1', {
      from: { kind: 'client', id: 'a' }, to: { kind: 'client', id: 'b' }, edgeType: 'aliases_with',
    })
    expect(result.error).toContain('empty response')
  })
})

describe('SupabaseGraphRepository.findNeighbors', () => {
  it('returns mapped edges, applies edgeType + limit when provided', async () => {
    const chain = makeChain(async () => ({ data: [ROW], error: null }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.findNeighbors(
      'biz-1',
      { kind: 'client', id: 'cli-A' },
      { edgeType: 'aliases_with', limit: 10 },
    )
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    expect(result.data![0]!.from.id).toBe('cli-A')

    // edge_type filter was applied
    const eqCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls
    expect(eqCalls).toContainEqual(['edge_type', 'aliases_with'])
    expect(chain.limit).toHaveBeenCalledWith(10)
  })

  it('returns empty array when Supabase returns no rows', async () => {
    const chain = makeChain(async () => ({ data: [], error: null }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.findNeighbors('biz-1', { kind: 'client', id: 'X' })
    expect(result.data).toEqual([])
  })

  it('returns fail when Supabase reports an error', async () => {
    const chain = makeChain(async () => ({ data: null, error: { message: 'RLS denied' } }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.findNeighbors('biz-1', { kind: 'client', id: 'X' })
    expect(result.error).toContain('findNeighbors')
  })
})

describe('SupabaseGraphRepository.findInverseEdges', () => {
  it('queries by to_kind/to_id and returns mapped edges', async () => {
    const chain = makeChain(async () => ({ data: [ROW], error: null }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.findInverseEdges(
      'biz-1',
      { kind: 'client', id: 'cli-B' },
      { edgeType: 'aliases_with' },
    )
    expect(result.error).toBeNull()
    const eqCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls
    expect(eqCalls).toContainEqual(['to_kind', 'client'])
    expect(eqCalls).toContainEqual(['to_id',   'cli-B'])
  })
})

describe('SupabaseGraphRepository.removeEdge', () => {
  it('deletes scoped by business_id + id and returns ok', async () => {
    const chain = makeChain(async () => ({ data: null, error: null }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.removeEdge('biz-1', 'edge-1')
    expect(result.error).toBeNull()
    const eqCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls
    expect(eqCalls).toContainEqual(['business_id', 'biz-1'])
    expect(eqCalls).toContainEqual(['id',          'edge-1'])
  })

  it('returns fail when Supabase reports an error', async () => {
    const chain = makeChain(async () => ({ data: null, error: { message: 'permission denied' } }))
    const repo  = new SupabaseGraphRepository(makeSupabase(() => chain))
    const result = await repo.removeEdge('biz-1', 'edge-1')
    expect(result.error).toContain('removeEdge')
    expect(result.error).toContain('permission denied')
  })
})
