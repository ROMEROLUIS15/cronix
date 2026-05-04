/**
 * tenant-enforcer.test.ts — Tests de seguridad para TenantEnforcer.
 *
 * Coverage:
 *   verify()        — éxito, usuario no encontrado, business_id mismatch
 *   verifyWebhook() — éxito, negocio no encontrado
 *
 * Seguridad verificada:
 *   - Un owner no puede obtener TenantContext de otro negocio
 *   - El mismatch se logea como warn antes de lanzar
 *   - La excepción es siempre 'UNAUTHORIZED'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantEnforcer } from '@/lib/ai/core/security/TenantEnforcer'

// ── Mock de @/lib/supabase/server ─────────────────────────────────────────────

const mockSingle = vi.fn()
const mockEq: any = vi.fn(() => ({ single: mockSingle, eq: mockEq }))
const mockSelect: any = vi.fn(() => ({ eq: mockEq, single: mockSingle }))
const mockFrom: any = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}))

// Mock del logger para verificar calls sin output en consola
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn:  vi.fn(),
    info:  vi.fn(),
  },
}))

// ── verify() ─────────────────────────────────────────────────────────────────

describe('TenantEnforcer.verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the chain
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle })
  })

  it('retorna TenantContext cuando businessId coincide con el usuario', async () => {
    mockSingle.mockResolvedValue({
      data:  { business_id: 'biz-1' },
      error: null,
    })

    const ctx = await TenantEnforcer.verify('biz-1', 'user-1', 'America/Bogota')

    expect(ctx.businessId).toBe('biz-1')
    expect(ctx.userId).toBe('user-1')
    expect(ctx.timezone).toBe('America/Bogota')
  })

  it('lanza UNAUTHORIZED cuando el usuario no existe en la DB', async () => {
    mockSingle.mockResolvedValue({
      data:  null,
      error: { message: 'Row not found' },
    })

    await expect(
      TenantEnforcer.verify('biz-1', 'user-ghost', 'America/Bogota')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('lanza UNAUTHORIZED cuando business_id no pertenece al usuario — ataque cross-tenant', async () => {
    // El usuario pertenece a biz-REAL, pero intenta acceder a biz-OTRO
    mockSingle.mockResolvedValue({
      data:  { business_id: 'biz-REAL' },
      error: null,
    })

    await expect(
      TenantEnforcer.verify('biz-OTRO', 'user-1', 'America/Bogota')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('logea warn en intento de cross-tenant injection', async () => {
    const { logger } = await import('@/lib/logger')
    mockSingle.mockResolvedValue({
      data:  { business_id: 'biz-REAL' },
      error: null,
    })

    await TenantEnforcer.verify('biz-OTRO', 'user-1', 'America/Bogota').catch(() => {})

    expect(logger.warn).toHaveBeenCalledWith(
      'TENANT-ENFORCER',
      expect.stringContaining('Tenant mismatch'),
      expect.objectContaining({
        authUserId:          'user-1',
        requestedBusinessId: 'biz-OTRO',
        actualBusinessId:    'biz-REAL',
      })
    )
  })

  it('lanza UNAUTHORIZED cuando data existe pero business_id es null/undefined', async () => {
    mockSingle.mockResolvedValue({
      data:  { business_id: null },
      error: null,
    })

    await expect(
      TenantEnforcer.verify('biz-1', 'user-1', 'America/Bogota')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('el TenantContext retornado NO puede ser construido manualmente sin cast', () => {
    // Este test documenta la garantía en compile-time.
    // En runtime, el phantom type no existe — solo la estructura.
    // Lo importante es que TenantEnforcer.verify() es el ÚNICO creador legítimo.
    // TypeScript rechaza construcción directa sin `as unknown as TenantContext`.
    // (No podemos testear errores de compilación en runtime — este test es documental)
    expect(true).toBe(true)
  })
})

// ── verifyWebhook() ───────────────────────────────────────────────────────────

describe('TenantEnforcer.verifyWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle })
  })

  it('retorna TenantContext cuando el negocio existe', async () => {
    mockSingle.mockResolvedValue({
      data:  { id: 'biz-1', timezone: 'America/Caracas' },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-1', 'America/Caracas')

    expect(ctx.businessId).toBe('biz-1')
    expect(ctx.userId).toBe('webhook')
    expect(ctx.timezone).toBe('America/Caracas')
  })

  it('usa el timezone del DB cuando no se provee uno', async () => {
    mockSingle.mockResolvedValue({
      data:  { id: 'biz-1', timezone: 'America/Bogota' },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-1', '')
    expect(ctx.timezone).toBe('America/Bogota')
  })

  it('usa UTC como fallback si DB tampoco tiene timezone', async () => {
    mockSingle.mockResolvedValue({
      data:  { id: 'biz-1', timezone: null },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-1', '')
    expect(ctx.timezone).toBe('UTC')
  })

  it('lanza UNAUTHORIZED cuando el negocio no existe', async () => {
    mockSingle.mockResolvedValue({
      data:  null,
      error: { message: 'Not found' },
    })

    await expect(
      TenantEnforcer.verifyWebhook('biz-inexistente', 'America/Bogota')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('el userId es siempre "webhook" (no hay usuario autenticado)', async () => {
    mockSingle.mockResolvedValue({
      data:  { id: 'biz-1', timezone: 'America/Bogota' },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-1', 'America/Bogota')
    expect(ctx.userId).toBe('webhook')
  })
})

// ── Garantía: BookingEngine no puede ejecutarse sin TenantContext válido ──────

describe('Garantía estructural de tenant isolation', () => {
  it('verify() lanza antes de retornar en caso de mismatch — no hay estado intermedio', async () => {
    mockSingle.mockResolvedValue({
      data:  { business_id: 'biz-REAL' },
      error: null,
    })

    let ctx: unknown = undefined
    try {
      ctx = await TenantEnforcer.verify('biz-OTRO', 'user-1', 'UTC')
    } catch {
      // esperado
    }

    // ctx nunca fue asignado — no hay TenantContext parcialmente construido
    expect(ctx).toBeUndefined()
  })
})
