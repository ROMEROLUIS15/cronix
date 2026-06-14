/**
 * supabase-client-repository.retention.test.ts
 *
 * Unit tests for the retention (win-back) methods of SupabaseClientRepository:
 *   findInactiveByFrequency — RPC name + args, row snake→camel mapping, error/empty
 *   updateLastReengaged     — scoped update, cache invalidation, error path
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the cache module so updateLastReengaged never touches Redis and we can
// assert the cross-channel invalidation (constitution §, modulo-voice-agent §8).
vi.mock('@/lib/cache', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(() => Promise.resolve()),
  },
  TTL: {},
  TTL_SEC: { CLIENTS: 180 },
}))

import cache from '@/lib/cache'
import { SupabaseClientRepository } from '@/lib/repositories/SupabaseClientRepository'

interface RpcResult {
  data: unknown
  error: { message: string } | null
}

const BIZ = 'biz-1'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── findInactiveByFrequency ──────────────────────────────────────────────────
describe('SupabaseClientRepository.findInactiveByFrequency', () => {
  function makeSupabase(result: RpcResult) {
    const rpc = vi.fn(() => Promise.resolve(result))
    return { supabase: { rpc } as never, rpc }
  }

  it('calls the deterministic RPC with the right name + args', async () => {
    const { supabase, rpc } = makeSupabase({ data: [], error: null })
    const repo = new SupabaseClientRepository(supabase)

    await repo.findInactiveByFrequency(BIZ, 30, 30)

    expect(rpc).toHaveBeenCalledWith('get_reengageable_clients_rpc', {
      biz_id: BIZ,
      frequency_days: 30,
      antispam_days: 30,
    })
  })

  it('maps RPC rows (snake_case) to EligibleClientRow (camelCase)', async () => {
    const { supabase } = makeSupabase({
      data: [
        {
          id: 'cli-1',
          name: 'Juan',
          phone: '+573210000001',
          last_visit_at: '2026-04-01T10:00:00Z',
          last_completed_at: '2026-04-01T10:00:00Z',
        },
      ],
      error: null,
    })
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.findInactiveByFrequency(BIZ, 30, 30)

    expect(result.error).toBeNull()
    expect(result.data).toEqual([
      {
        id: 'cli-1',
        name: 'Juan',
        phone: '+573210000001',
        lastVisitAt: '2026-04-01T10:00:00Z',
        lastCompletedAt: '2026-04-01T10:00:00Z',
      },
    ])
  })

  it('returns an empty array when the RPC yields null data', async () => {
    const { supabase } = makeSupabase({ data: null, error: null })
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.findInactiveByFrequency(BIZ, 30, 30)

    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('fails (never throws) on RPC error', async () => {
    const { supabase } = makeSupabase({ data: null, error: { message: 'boom' } })
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.findInactiveByFrequency(BIZ, 30, 30)

    expect(result.data).toBeNull()
    expect(result.error).toContain('boom')
  })
})

// ── updateLastReengaged ──────────────────────────────────────────────────────
describe('SupabaseClientRepository.updateLastReengaged', () => {
  function makeSupabase(error: { message: string } | null) {
    const calls = { update: undefined as unknown, eqArgs: [] as unknown[][] }
    const chain: Record<string, unknown> = {
      update: vi.fn((patch: unknown) => {
        calls.update = patch
        return chain
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.eqArgs.push(args)
        return chain
      }),
      then: (resolve: (v: { error: typeof error }) => void) =>
        Promise.resolve({ error }).then(resolve),
    }
    const from = vi.fn(() => chain)
    return { supabase: { from } as never, from, chain, calls }
  }

  it('stamps last_reengaged_at, scoped by id + business_id, and invalidates cache', async () => {
    const { supabase, from, calls } = makeSupabase(null)
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.updateLastReengaged('cli-1', BIZ)

    expect(result.error).toBeNull()
    expect(result.data).toBeUndefined()
    expect(from).toHaveBeenCalledWith('clients')
    expect(calls.update).toMatchObject({ last_reengaged_at: expect.any(String) })
    expect(calls.eqArgs).toEqual([
      ['id', 'cli-1'],
      ['business_id', BIZ],
    ])
    expect(cache.invalidate).toHaveBeenCalledWith(BIZ, 'clients')
  })

  it('fails and does not invalidate cache on update error', async () => {
    const { supabase } = makeSupabase({ message: 'denied' })
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.updateLastReengaged('cli-1', BIZ)

    expect(result.data).toBeNull()
    expect(result.error).toContain('denied')
    expect(cache.invalidate).not.toHaveBeenCalled()
  })
})

// ── setRetentionOptOut ────────────────────────────────────────────────────────
describe('SupabaseClientRepository.setRetentionOptOut', () => {
  function makeSupabase(error: { message: string } | null) {
    const calls = { update: undefined as unknown, eqArgs: [] as unknown[][] }
    const chain: Record<string, unknown> = {
      update: vi.fn((patch: unknown) => {
        calls.update = patch
        return chain
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.eqArgs.push(args)
        return chain
      }),
      then: (resolve: (v: { error: typeof error }) => void) =>
        Promise.resolve({ error }).then(resolve),
    }
    const from = vi.fn(() => chain)
    return { supabase: { from } as never, from, calls }
  }

  it('marks opt-out matched by normalized phone_digits + business, invalidates cache', async () => {
    const { supabase, from, calls } = makeSupabase(null)
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.setRetentionOptOut('+57 321 000 0001', BIZ)

    expect(result.error).toBeNull()
    expect(from).toHaveBeenCalledWith('clients')
    expect(calls.update).toEqual({ retention_opted_out: true })
    expect(calls.eqArgs).toEqual([
      ['business_id', BIZ],
      ['phone_digits', '573210000001'],
    ])
    expect(cache.invalidate).toHaveBeenCalledWith(BIZ, 'clients')
  })

  it('fails and does not invalidate cache on error', async () => {
    const { supabase } = makeSupabase({ message: 'nope' })
    const repo = new SupabaseClientRepository(supabase)

    const result = await repo.setRetentionOptOut('573210000001', BIZ)

    expect(result.data).toBeNull()
    expect(result.error).toContain('nope')
    expect(cache.invalidate).not.toHaveBeenCalled()
  })
})
