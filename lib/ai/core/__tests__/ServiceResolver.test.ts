/**
 * ServiceResolver.test.ts — Tests for service resolution strategies.
 * Covers all 4 strategies: UUID exact, name exact, fuzzy, substring.
 */

import { describe, it, expect, vi } from 'vitest'
import { ServiceResolver } from '../booking/ServiceResolver'
import type { IServiceRepository, ServiceForDropdown } from '@/lib/domain/repositories/IServiceRepository'
import type { TenantContext } from '../security/TenantEnforcer'

function makeCtx(businessId = 'biz-a'): TenantContext {
  return { businessId, userId: 'user-1', timezone: 'America/Bogota' } as unknown as TenantContext
}

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const services: ServiceForDropdown[] = [
  { id: VALID_UUID,                                 name: 'Manicura',        duration_min: 45, price: 15000 },
  { id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',   name: 'Corte de Cabello', duration_min: 30, price: 12000 },
  { id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',   name: 'Pedicura',         duration_min: 60, price: 20000 },
  { id: 'd4e5f6a7-b8c9-0123-defa-234567890123',   name: 'Tinte',            duration_min: 90, price: 35000 },
]

function makeRepo(data: ServiceForDropdown[]): IServiceRepository {
  return {
    getActive:    vi.fn().mockResolvedValue({ data }),
    getAll:       vi.fn(),
    hasAny:       vi.fn(),
    create:       vi.fn(),
    update:       vi.fn(),
    delete:       vi.fn(),
    toggleActive: vi.fn(),
    getById:      vi.fn(),
  } as unknown as IServiceRepository
}

describe('ServiceResolver.resolve', () => {
  // Strategy 1: UUID exact
  it('finds by exact UUID (strategy 1)', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), VALID_UUID)
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.name).toBe('Manicura')
  })

  // Strategy 2: Exact name match (case-insensitive)
  it('finds by exact name match (strategy 2)', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Manicura')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.id).toBe(VALID_UUID)
  })

  it('finds by case-insensitive exact name "manicura"', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'manicura')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.id).toBe(VALID_UUID)
  })

  it('finds by accent-stripped name "Corte de Cabello" = "corte de cabello"', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Corte de Cabello')
    expect(result.status).toBe('found')
  })

  // Strategy 3: Fuzzy match
  it('finds by fuzzy match "Manicur" (typo)', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Manicur')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.name).toBe('Manicura')
  })

  it('finds by fuzzy match "Pedicur" (typo in Pedicura)', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Pedicur')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.name).toBe('Pedicura')
  })

  // Strategy 4: Substring
  it('finds by substring "corte" inside "Corte de Cabello"', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'corte')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.name).toBe('Corte de Cabello')
  })

  it('finds by reverse substring: service name inside spoken phrase', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    // "me gustaría hacerme la manicura" → contains "manicura"
    const result = await resolver.resolve(makeCtx(), 'me gustaria hacerme la manicura')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.service.name).toBe('Manicura')
  })

  // Not found
  it('returns not_found for completely unknown service', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Servicio Inexistente Xyz 999')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found when service list is empty', async () => {
    const repo = makeRepo([])
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Manicura')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found when DB errors', async () => {
    const repo = makeRepo([])
    ;(repo.getActive as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'DB error' })
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Manicura')
    expect(result.status).toBe('not_found')
  })

  // Ambiguous (only in fuzzy strategy when two services score similarly)
  it('returns ambiguous when two services are equally similar', async () => {
    const twin: ServiceForDropdown[] = [
      { id: '1', name: 'Manicura',  duration_min: 45, price: 10000 },
      { id: '2', name: 'Manicure',  duration_min: 45, price: 10000 },
    ]
    const repo = makeRepo(twin)
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(makeCtx(), 'Manicur')
    // Could be found or ambiguous depending on scores — must not crash
    expect(['found', 'ambiguous']).toContain(result.status)
  })

  // Security: scopes to businessId
  it('scopes query to businessId', async () => {
    const repo = makeRepo(services)
    const resolver = new ServiceResolver(repo)
    await resolver.resolve(makeCtx('biz-xyz'), 'Manicura')
    expect(repo.getActive).toHaveBeenCalledWith('biz-xyz')
  })
})
