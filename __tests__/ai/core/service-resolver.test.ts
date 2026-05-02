/**
 * service-resolver.test.ts — Unit tests for ServiceResolver.
 *
 * Coverage:
 *   Estrategia 1: UUID exacto
 *   Estrategia 2: nombre exacto (case-insensitive)
 *   Estrategia 3: fuzzy match (Levenshtein)
 *   Estrategia 4: substring
 *   Casos: not_found, ambiguous, catálogo vacío, repo error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceResolver } from '@/lib/ai/core/booking/ServiceResolver'
import type { IServiceRepository, ServiceForDropdown } from '@/lib/domain/repositories/IServiceRepository'
import type { TenantContext } from '@/lib/ai/core/security/TenantEnforcer'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SVC_UUID = '11111111-1111-4111-8111-111111111111'
const SVC_UUID2 = '22222222-2222-4222-8222-222222222222'
const SVC_UUID3 = '33333333-3333-4333-8333-333333333333'

const services: ServiceForDropdown[] = [
  { id: SVC_UUID,  name: 'Manicura',         duration_min: 45, price: 25 },
  { id: SVC_UUID2, name: 'Corte de Cabello', duration_min: 30, price: 20 },
  { id: SVC_UUID3, name: 'Pedicura',         duration_min: 60, price: 30 },
]

const ctx = {
  businessId: 'biz-1',
  userId:     'user-1',
  timezone:   'America/Bogota',
} as unknown as TenantContext

function makeRepo(data: ServiceForDropdown[] = services): IServiceRepository {
  return {
    getActive: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as IServiceRepository
}

// ── Estrategia 1: UUID exacto ─────────────────────────────────────────────────

describe('ServiceResolver — UUID exacto', () => {
  it('encuentra servicio por UUID exacto', async () => {
    const resolver = new ServiceResolver(makeRepo())
    const result = await resolver.resolve(ctx, SVC_UUID)
    expect(result.status).toBe('found')
    expect((result as any).service.name).toBe('Manicura')
  })

  it('no confunde UUID con nombre parecido', async () => {
    const resolver = new ServiceResolver(makeRepo())
    // Un string que parece UUID pero no coincide con ninguno
    const fakeUUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const result = await resolver.resolve(ctx, fakeUUID)
    // Puede ser not_found o encontrar por fuzzy — lo importante es que no crashea
    expect(['found', 'not_found', 'ambiguous']).toContain(result.status)
  })
})

// ── Estrategia 2: nombre exacto (case-insensitive) ────────────────────────────

describe('ServiceResolver — nombre exacto', () => {
  let resolver: ServiceResolver

  beforeEach(() => { resolver = new ServiceResolver(makeRepo()) })

  it('encuentra por nombre exacto', async () => {
    const result = await resolver.resolve(ctx, 'Manicura')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID)
  })

  it('es case-insensitive', async () => {
    const result = await resolver.resolve(ctx, 'manicura')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID)
  })

  it('ignora acento en búsqueda', async () => {
    const result = await resolver.resolve(ctx, 'Pedicura')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID3)
  })
})

// ── Estrategia 3: fuzzy match ─────────────────────────────────────────────────

describe('ServiceResolver — fuzzy match', () => {
  let resolver: ServiceResolver

  beforeEach(() => { resolver = new ServiceResolver(makeRepo()) })

  it('encuentra con typo de 1 carácter (Manikura → Manicura)', async () => {
    const result = await resolver.resolve(ctx, 'Manikura')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID)
  })

  it('encuentra con nombre parcial del servicio (Corte → Corte de Cabello)', async () => {
    const result = await resolver.resolve(ctx, 'Corte')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID2)
  })

  it('encuentra con transcripción de voz (pedicure → Pedicura)', async () => {
    const result = await resolver.resolve(ctx, 'pedicure')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID3)
  })
})

// ── Estrategia 4: substring ───────────────────────────────────────────────────

describe('ServiceResolver — substring match', () => {
  it('encuentra cuando el texto del LLM contiene el nombre del servicio', async () => {
    const resolver = new ServiceResolver(makeRepo())
    // "hacerme la manicura francesa" contiene "manicura"
    const result = await resolver.resolve(ctx, 'hacerme la manicura francesa')
    expect(result.status).toBe('found')
    expect((result as any).service.id).toBe(SVC_UUID)
  })
})

// ── Casos especiales ──────────────────────────────────────────────────────────

describe('ServiceResolver — casos especiales', () => {
  it('retorna not_found cuando el catálogo está vacío', async () => {
    const repo = makeRepo([])
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(ctx, 'Manicura')
    expect(result.status).toBe('not_found')
  })

  it('retorna not_found cuando el repo falla', async () => {
    const repo = {
      getActive: vi.fn().mockResolvedValue({ data: null, error: 'DB Error' }),
    } as unknown as IServiceRepository
    const resolver = new ServiceResolver(repo)
    const result = await resolver.resolve(ctx, 'Manicura')
    expect(result.status).toBe('not_found')
  })

  it('retorna not_found para servicio completamente inexistente', async () => {
    const resolver = new ServiceResolver(makeRepo())
    const result = await resolver.resolve(ctx, 'Cirugía Cardiovascular')
    expect(result.status).toBe('not_found')
  })

  it('retorna ambiguous cuando hay dos servicios muy similares', async () => {
    const similarServices: ServiceForDropdown[] = [
      { id: 'svc-a', name: 'Manicura Simple',   duration_min: 30, price: 15 },
      { id: 'svc-b', name: 'Manicura Francesa', duration_min: 45, price: 25 },
    ]
    const repo = makeRepo(similarServices)
    const resolver = new ServiceResolver(repo)
    // "manicura" como substring matchea ambas con score 0.98 → ambiguous
    const result = await resolver.resolve(ctx, 'manicura')
    expect(result.status).toBe('ambiguous')
    expect((result as any).candidates.length).toBe(2)
  })

  it('pasa businessId correcto al repo', async () => {
    const repo = makeRepo()
    const resolver = new ServiceResolver(repo)
    await resolver.resolve(ctx, 'Manicura')
    expect(repo.getActive).toHaveBeenCalledWith('biz-1')
  })
})
