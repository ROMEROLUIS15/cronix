/**
 * ClientResolver.test.ts — Tests for deterministic client resolution.
 *
 * Covers: byName (fuzzy), byId (exact), byPhone (Venezuelan variants), resolve (entry point).
 * Security: ensures business isolation is respected (businessId scoping).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClientResolver } from '../booking/ClientResolver'
import type { IClientRepository, ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import type { TenantContext } from '../security/TenantEnforcer'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(businessId = 'biz-a'): TenantContext {
  return { businessId, userId: 'user-1', timezone: 'America/Bogota' } as unknown as TenantContext
}

function makeRepo(clients: ClientForAI[]): IClientRepository {
  return {
    findActiveForAI: vi.fn().mockResolvedValue({ data: clients }),
    getById: vi.fn().mockResolvedValue({ data: null }),
    getAll: vi.fn(),
    getAllForSelect: vi.fn(),
    getAppointments: vi.fn(),
    insert: vi.fn(),
    findInactive: vi.fn(),
  } as unknown as IClientRepository
}

const sampleClients: ClientForAI[] = [
  { id: 'c1', name: 'Ana García',      phone: '+58 424 123 4567' },
  { id: 'c2', name: 'Carlos López',    phone: '04141234567' },
  { id: 'c3', name: 'María Rodríguez', phone: null },
  { id: 'c4', name: 'Juan Pérez',      phone: '584241112222' },
]

// ── byName ────────────────────────────────────────────────────────────────────

describe('ClientResolver.byName', () => {
  it('finds client by exact name', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.byName(makeCtx(), 'Ana García')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.id).toBe('c1')
  })

  it('finds client by accent-stripped name "Maria Rodriguez"', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.byName(makeCtx(), 'Maria Rodriguez')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.id).toBe('c3')
  })

  it('finds client with voice typo "Ann Garcia"', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.byName(makeCtx(), 'Ann Garcia')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.id).toBe('c1')
  })

  it('returns not_found when no match above threshold', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.byName(makeCtx(), 'Zoltan Xyz Completely Unknown')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found when client list is empty', async () => {
    const repo = makeRepo([])
    const resolver = new ClientResolver(repo)
    const result = await resolver.byName(makeCtx(), 'Ana')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found when DB returns error', async () => {
    const repo = makeRepo([])
    ;(repo.findActiveForAI as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'DB down' })
    const resolver = new ClientResolver(repo)
    const result = await resolver.byName(makeCtx(), 'Ana')
    expect(result.status).toBe('not_found')
  })

  it('scopes query to businessId', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    await resolver.byName(makeCtx('biz-x'), 'Ana')
    expect(repo.findActiveForAI).toHaveBeenCalledWith('biz-x')
  })

  it('does NOT return clients from other business (cross-tenant guard)', async () => {
    const repo = makeRepo([])
    const resolver = new ClientResolver(repo)
    // biz-b has no clients
    const result = await resolver.byName(makeCtx('biz-b'), 'Ana García')
    expect(result.status).toBe('not_found')
    // Verify it queried biz-b, not biz-a
    expect(repo.findActiveForAI).toHaveBeenCalledWith('biz-b')
    expect(repo.findActiveForAI).not.toHaveBeenCalledWith('biz-a')
  })
})

// ── byId ─────────────────────────────────────────────────────────────────────

describe('ClientResolver.byId', () => {
  it('finds client by exact UUID', async () => {
    const client: ClientForAI = { id: 'c1', name: 'Ana García', phone: null }
    const repo: IClientRepository = {
      getById: vi.fn().mockResolvedValue({ data: client }),
      findActiveForAI: vi.fn(),
      getAll: vi.fn(),
      getAllForSelect: vi.fn(),
      getAppointments: vi.fn(),
      insert: vi.fn(),
      findInactive: vi.fn(),
    } as unknown as IClientRepository

    const resolver = new ClientResolver(repo)
    const result = await resolver.byId(makeCtx('biz-a'), 'c1')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.name).toBe('Ana García')
  })

  it('passes businessId for isolation', async () => {
    const repo: IClientRepository = {
      getById: vi.fn().mockResolvedValue({ data: null }),
      findActiveForAI: vi.fn(),
      getAll: vi.fn(),
      getAllForSelect: vi.fn(),
      getAppointments: vi.fn(),
      insert: vi.fn(),
      findInactive: vi.fn(),
    } as unknown as IClientRepository

    const resolver = new ClientResolver(repo)
    await resolver.byId(makeCtx('biz-x'), 'c1')
    expect(repo.getById).toHaveBeenCalledWith('c1', 'biz-x')
  })

  it('returns not_found when client does not exist', async () => {
    const repo: IClientRepository = {
      getById: vi.fn().mockResolvedValue({ data: null }),
      findActiveForAI: vi.fn(),
      getAll: vi.fn(),
      getAllForSelect: vi.fn(),
      getAppointments: vi.fn(),
      insert: vi.fn(),
      findInactive: vi.fn(),
    } as unknown as IClientRepository

    const resolver = new ClientResolver(repo)
    const result = await resolver.byId(makeCtx(), 'nonexistent-id')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found when DB errors', async () => {
    const repo: IClientRepository = {
      getById: vi.fn().mockResolvedValue({ error: 'DB error' }),
      findActiveForAI: vi.fn(),
      getAll: vi.fn(),
      getAllForSelect: vi.fn(),
      getAppointments: vi.fn(),
      insert: vi.fn(),
      findInactive: vi.fn(),
    } as unknown as IClientRepository

    const resolver = new ClientResolver(repo)
    const result = await resolver.byId(makeCtx(), 'c1')
    expect(result.status).toBe('not_found')
  })
})

// ── byPhone ───────────────────────────────────────────────────────────────────

describe('ClientResolver.byPhone', () => {
  it('finds by exact phone match', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    // c2 has '04141234567'
    const result = await resolver.byPhone(makeCtx(), '04141234567')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.id).toBe('c2')
  })

  it('finds by phone with spaces/dashes stripped ("+58 424 123 4567" vs "584241234567")', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    // c1 stored as '+58 424 123 4567' → digits '584241234567'
    const result = await resolver.byPhone(makeCtx(), '584241234567')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.id).toBe('c1')
  })

  it('handles Venezuelan variant: "58 0424..." vs "58 424..." (c4)', async () => {
    // c4 stored as '584241112222' (no leading 0)
    // incoming '5804241112222' (with leading 0 after country code)
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.byPhone(makeCtx(), '5804241112222')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.client.id).toBe('c4')
  })

  it('returns not_found when no phone matches', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.byPhone(makeCtx(), '9999999999')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found for client with null phone', async () => {
    const repo = makeRepo([{ id: 'c3', name: 'María', phone: null }])
    const resolver = new ClientResolver(repo)
    const result = await resolver.byPhone(makeCtx(), '04141234567')
    expect(result.status).toBe('not_found')
  })
})

// ── resolve (entry point) ─────────────────────────────────────────────────────

describe('ClientResolver.resolve', () => {
  it('uses byId when clientId is provided', async () => {
    const client: ClientForAI = { id: 'c1', name: 'Ana', phone: null }
    const repo: IClientRepository = {
      getById: vi.fn().mockResolvedValue({ data: client }),
      findActiveForAI: vi.fn(),
      getAll: vi.fn(),
      getAllForSelect: vi.fn(),
      getAppointments: vi.fn(),
      insert: vi.fn(),
      findInactive: vi.fn(),
    } as unknown as IClientRepository

    const resolver = new ClientResolver(repo)
    const result = await resolver.resolve(makeCtx(), { clientId: 'c1' })
    expect(result.status).toBe('found')
    expect(repo.getById).toHaveBeenCalledWith('c1', 'biz-a')
    expect(repo.findActiveForAI).not.toHaveBeenCalled()
  })

  it('uses byName when only clientName is provided', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    await resolver.resolve(makeCtx(), { clientName: 'Ana García' })
    expect(repo.findActiveForAI).toHaveBeenCalled()
  })

  it('returns not_found when both clientId and clientName are missing', async () => {
    const repo = makeRepo(sampleClients)
    const resolver = new ClientResolver(repo)
    const result = await resolver.resolve(makeCtx(), {})
    expect(result.status).toBe('not_found')
  })

  it('clientId takes priority over clientName', async () => {
    const client: ClientForAI = { id: 'c1', name: 'Ana', phone: null }
    const repo: IClientRepository = {
      getById: vi.fn().mockResolvedValue({ data: client }),
      findActiveForAI: vi.fn(),
      getAll: vi.fn(),
      getAllForSelect: vi.fn(),
      getAppointments: vi.fn(),
      insert: vi.fn(),
      findInactive: vi.fn(),
    } as unknown as IClientRepository

    const resolver = new ClientResolver(repo)
    await resolver.resolve(makeCtx(), { clientId: 'c1', clientName: 'Carlos' })
    expect(repo.getById).toHaveBeenCalled()
    expect(repo.findActiveForAI).not.toHaveBeenCalled()
  })
})
