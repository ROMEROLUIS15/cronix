/**
 * supabase-business-repository.retention.test.ts
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §6 — cron fan-out query.
 * findRetentionEnabledIds returns Pro+ businesses with settings.retention.enabled.
 */

import { describe, it, expect, vi } from 'vitest'
import { SupabaseBusinessRepository } from '@/lib/repositories/SupabaseBusinessRepository'

interface ChainResult {
  data: { id: string }[] | null
  error: { message: string } | null
}

function makeSupabase(result: ChainResult) {
  const calls = { in: [] as unknown[][], eq: [] as unknown[][] }
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    in: vi.fn((...a: unknown[]) => {
      calls.in.push(a)
      return chain
    }),
    eq: vi.fn((...a: unknown[]) => {
      calls.eq.push(a)
      return chain
    }),
    then: (resolve: (v: ChainResult) => void) => Promise.resolve(result).then(resolve),
  }
  const from = vi.fn(() => chain)
  return { supabase: { from } as never, from, calls }
}

describe('SupabaseBusinessRepository.findRetentionEnabledIds', () => {
  it('filters by Pro+ plan and the retention toggle, returning ids', async () => {
    const { supabase, from, calls } = makeSupabase({
      data: [{ id: 'biz-1' }, { id: 'biz-2' }],
      error: null,
    })
    const repo = new SupabaseBusinessRepository(supabase)

    const result = await repo.findRetentionEnabledIds()

    expect(result.error).toBeNull()
    expect(result.data).toEqual(['biz-1', 'biz-2'])
    expect(from).toHaveBeenCalledWith('businesses')
    expect(calls.in).toEqual([['plan', ['pro', 'enterprise']]])
    expect(calls.eq).toEqual([['settings->retention->>enabled', 'true']])
  })

  it('returns an empty array when no business qualifies', async () => {
    const { supabase } = makeSupabase({ data: [], error: null })
    const repo = new SupabaseBusinessRepository(supabase)

    const result = await repo.findRetentionEnabledIds()

    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('fails (never throws) on query error', async () => {
    const { supabase } = makeSupabase({ data: null, error: { message: 'boom' } })
    const repo = new SupabaseBusinessRepository(supabase)

    const result = await repo.findRetentionEnabledIds()

    expect(result.data).toBeNull()
    expect(result.error).toContain('boom')
  })
})
