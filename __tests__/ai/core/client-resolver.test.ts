/**
 * client-resolver.test.ts — Unit tests for ClientResolver.
 *
 * Coverage:
 *   byName  — fuzzy match, not_found, ambiguous
 *   byId    — exact match, not_found (wrong business)
 *   byPhone — exact, Venezuelan variant, not_found
 *   resolve — routing logic entre byId y byName
 *
 * TenantContext se construye con cast (es phantom type, no existe en runtime).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClientResolver } from '@/lib/ai/core/booking/ClientResolver'
import type { IClientRepository, ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import type { TenantContext } from '@/lib/ai/core/security/TenantEnforcer'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLI_1: ClientForAI = { id: 'cli-1', name: 'Ana García',   phone: '+57 300 111 1111' }
const CLI_2: ClientForAI = { id: 'cli-2', name: 'Ana Martínez', phone: '+57 300 222 2222' }
const CLI_3: ClientForAI = { id: 'cli-3', name: 'Pedro López',  phone: '584241234567' }
const CLI_4: ClientForAI = { id: 'cli-4', name: 'Juan Pérez',   phone: null }

const ctx = {
  businessId: 'biz-1',
  userId:     'user-1',
  timezone:   'America/Bogota',
} as unknown as TenantContext

// ── Repo mock factory ─────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<IClientRepository> = {}): IClientRepository {
  return {
    findActiveForAI: vi.fn().mockResolvedValue({
      data: [CLI_1, CLI_2, CLI_3, CLI_4],
      error: null,
    }),
    getById: vi.fn().mockImplementation(async (id: string, businessId: string) => {
      if (businessId !== 'biz-1') return { data: null, error: 'Not found' }
      const client = [CLI_1, CLI_2, CLI_3, CLI_4].find(c => c.id === id)
      return client ? { data: client, error: null } : { data: null, error: null }
    }),
    ...overrides,
  } as unknown as IClientRepository
}

// ── byName ────────────────────────────────────────────────────────────────────

describe('ClientResolver.byName', () => {
  let resolver: ClientResolver
  let repo: IClientRepository

  beforeEach(() => {
    repo = makeRepo()
    resolver = new ClientResolver(repo)
  })

  it('encuentra cliente por nombre exacto', async () => {
    const result = await resolver.byName(ctx, 'Pedro López')
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-3')
  })

  it('encuentra cliente con acento diferente (fuzzy)', async () => {
    const result = await resolver.byName(ctx, 'Pedro Lopez')
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-3')
  })

  it('encuentra cliente por nombre de 3 palabras', async () => {
    const clients: ClientForAI[] = [
      { id: 'cli-5', name: 'Juan Pérez Gómez', phone: null },
      { id: 'cli-6', name: 'Carlos Rodríguez', phone: null },
    ]
    const specificRepo = makeRepo({
      findActiveForAI: vi.fn().mockResolvedValue({ data: clients, error: null }),
    })
    const specificResolver = new ClientResolver(specificRepo)
    const result = await specificResolver.byName(ctx, 'Juan Perez Gomez')
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-5')
  })

  it('retorna ambiguous cuando dos clientes tienen el mismo primer nombre', async () => {
    // "Ana" matchea tanto "Ana García" como "Ana Martínez"
    const result = await resolver.byName(ctx, 'Ana')
    // Ambas tienen score 0.98 (substring), gap = 0 → ambiguous
    expect(result.status).toBe('ambiguous')
    expect((result as any).candidates.length).toBeGreaterThanOrEqual(2)
  })

  it('retorna not_found para nombre sin match', async () => {
    const result = await resolver.byName(ctx, 'XYZ Inexistente')
    expect(result.status).toBe('not_found')
  })

  it('retorna not_found cuando el repo falla', async () => {
    const errorRepo = makeRepo({
      findActiveForAI: vi.fn().mockResolvedValue({ data: null, error: 'DB error' }),
    })
    const resolver = new ClientResolver(errorRepo)
    const result = await resolver.byName(ctx, 'Ana García')
    expect(result.status).toBe('not_found')
  })

  it('pasa el businessId correcto al repo', async () => {
    await resolver.byName(ctx, 'Ana García')
    expect(repo.findActiveForAI).toHaveBeenCalledWith('biz-1')
  })
})

// ── byId ──────────────────────────────────────────────────────────────────────

describe('ClientResolver.byId', () => {
  let resolver: ClientResolver
  let repo: IClientRepository

  beforeEach(() => {
    repo = makeRepo()
    resolver = new ClientResolver(repo)
  })

  it('encuentra cliente por ID exacto', async () => {
    const result = await resolver.byId(ctx, 'cli-1')
    expect(result.status).toBe('found')
    expect((result as any).client.name).toBe('Ana García')
  })

  it('retorna not_found para ID de otro negocio', async () => {
    const crossTenantCtx = { ...ctx, businessId: 'biz-OTRO' } as unknown as TenantContext
    const result = await resolver.byId(crossTenantCtx, 'cli-1')
    expect(result.status).toBe('not_found')
  })

  it('retorna not_found para ID inexistente', async () => {
    const result = await resolver.byId(ctx, 'cli-999')
    expect(result.status).toBe('not_found')
  })
})

// ── byPhone ───────────────────────────────────────────────────────────────────

describe('ClientResolver.byPhone', () => {
  let resolver: ClientResolver

  beforeEach(() => {
    resolver = new ClientResolver(makeRepo())
  })

  it('encuentra cliente por número exacto (sin formato)', async () => {
    const result = await resolver.byPhone(ctx, '584241234567')
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-3')
  })

  it('encuentra cliente con número formateado (+57 300 111 1111)', async () => {
    const result = await resolver.byPhone(ctx, '+57300 1111111')
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-1')
  })

  it('encuentra cliente con variante venezolana (58 0424 vs 58 424)', async () => {
    // CLI_3 tiene '584241234567', el incoming es '5804241234567' (con 0)
    const clients: ClientForAI[] = [
      { id: 'cli-ven', name: 'Carmen', phone: '584241234567' },
    ]
    const repo = makeRepo({
      findActiveForAI: vi.fn().mockResolvedValue({ data: clients, error: null }),
    })
    const resolver = new ClientResolver(repo)
    const result = await resolver.byPhone(ctx, '5804241234567')
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-ven')
  })

  it('retorna not_found para número inexistente', async () => {
    const result = await resolver.byPhone(ctx, '999999999999')
    expect(result.status).toBe('not_found')
  })

  it('retorna not_found para cliente sin teléfono (phone: null)', async () => {
    // Juan Pérez tiene phone: null — no debe matchear ningún número
    const clients: ClientForAI[] = [
      { id: 'cli-sin-tel', name: 'Sin Teléfono', phone: null },
    ]
    const repo = makeRepo({
      findActiveForAI: vi.fn().mockResolvedValue({ data: clients, error: null }),
    })
    const resolver = new ClientResolver(repo)
    const result = await resolver.byPhone(ctx, '5804241234567')
    expect(result.status).toBe('not_found')
  })
})

// ── resolve (entry point principal) ──────────────────────────────────────────

describe('ClientResolver.resolve', () => {
  let resolver: ClientResolver
  let repo: IClientRepository

  beforeEach(() => {
    repo = makeRepo()
    resolver = new ClientResolver(repo)
  })

  it('prefiere clientId sobre clientName cuando ambos se proveen', async () => {
    const result = await resolver.resolve(ctx, {
      clientId:   'cli-1',
      clientName: 'Pedro López',  // debería ignorarse
    })
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-1')  // cli-1, no cli-3
    expect(repo.getById).toHaveBeenCalled()
    expect(repo.findActiveForAI).not.toHaveBeenCalled()
  })

  it('usa clientName cuando no hay clientId', async () => {
    const result = await resolver.resolve(ctx, { clientName: 'Pedro López' })
    expect(result.status).toBe('found')
    expect((result as any).client.id).toBe('cli-3')
    expect(repo.findActiveForAI).toHaveBeenCalled()
  })

  it('retorna not_found cuando no se provee ni ID ni nombre', async () => {
    const result = await resolver.resolve(ctx, {})
    expect(result.status).toBe('not_found')
    expect(repo.getById).not.toHaveBeenCalled()
    expect(repo.findActiveForAI).not.toHaveBeenCalled()
  })
})
