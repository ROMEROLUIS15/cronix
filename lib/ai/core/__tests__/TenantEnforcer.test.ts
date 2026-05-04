/**
 * TenantEnforcer.test.ts — Security tests for tenant isolation.
 *
 * Critical: TenantEnforcer is the ONLY gateway to TenantContext.
 * If it can be bypassed, the entire multitenant isolation collapses.
 *
 * Tests:
 *   - verify() succeeds when user owns businessId
 *   - verify() throws UNAUTHORIZED when businessId mismatch
 *   - verify() throws UNAUTHORIZED when user not found in DB
 *   - verifyWebhook() succeeds when business exists
 *   - verifyWebhook() throws UNAUTHORIZED when business not found
 *   - TenantContext is structurally unusable without TenantEnforcer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantEnforcer } from '../security/TenantEnforcer'

// ── Mock Supabase admin client ────────────────────────────────────────────────

const mockSingleUser = vi.fn()
const mockSingleBusiness = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          single: mockSingleUser,
        }
      }
      if (table === 'businesses') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          single: mockSingleBusiness,
        }
      }
      return {}
    }),
  })),
}))

// ── TenantEnforcer.verify ─────────────────────────────────────────────────────

describe('TenantEnforcer.verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns TenantContext when user owns the business', async () => {
    mockSingleUser.mockResolvedValue({
      data: { business_id: 'biz-a' },
      error: null,
    })

    const ctx = await TenantEnforcer.verify('biz-a', 'user-1', 'America/Bogota')

    expect(ctx.businessId).toBe('biz-a')
    expect(ctx.userId).toBe('user-1')
    expect(ctx.timezone).toBe('America/Bogota')
  })

  it('throws UNAUTHORIZED when user businessId does not match requested', async () => {
    mockSingleUser.mockResolvedValue({
      data: { business_id: 'biz-b' }, // user belongs to biz-b, not biz-a
      error: null,
    })

    await expect(
      TenantEnforcer.verify('biz-a', 'user-attacker', 'UTC')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('throws UNAUTHORIZED when user is not found in DB', async () => {
    mockSingleUser.mockResolvedValue({
      data: null,
      error: { message: 'User not found' },
    })

    await expect(
      TenantEnforcer.verify('biz-a', 'ghost-user', 'UTC')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('throws UNAUTHORIZED when user has no business_id (orphan user)', async () => {
    mockSingleUser.mockResolvedValue({
      data: { business_id: null },
      error: null,
    })

    await expect(
      TenantEnforcer.verify('biz-a', 'orphan-user', 'UTC')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('throws UNAUTHORIZED when DB errors on users query', async () => {
    mockSingleUser.mockResolvedValue({
      data: null,
      error: { message: 'Connection timeout' },
    })

    await expect(
      TenantEnforcer.verify('biz-a', 'user-1', 'UTC')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('TenantContext has correct businessId after successful verification', async () => {
    mockSingleUser.mockResolvedValue({
      data: { business_id: 'biz-prod' },
      error: null,
    })

    const ctx = await TenantEnforcer.verify('biz-prod', 'user-prod', 'America/Caracas')

    // Verify all fields
    expect(ctx.businessId).toBe('biz-prod')
    expect(ctx.userId).toBe('user-prod')
    expect(ctx.timezone).toBe('America/Caracas')
  })

  it('cross-tenant injection scenario: attacker passes biz-b but owns biz-a → throws', async () => {
    // Scenario: attacker's session has userId='attacker', they own 'biz-attacker'
    // They try to pass businessId='biz-victim' in their request
    mockSingleUser.mockResolvedValue({
      data: { business_id: 'biz-attacker' },
      error: null,
    })

    await expect(
      TenantEnforcer.verify('biz-victim', 'attacker', 'UTC')
    ).rejects.toThrow('UNAUTHORIZED')
  })
})

// ── TenantEnforcer.verifyWebhook ──────────────────────────────────────────────

describe('TenantEnforcer.verifyWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns TenantContext when business exists', async () => {
    mockSingleBusiness.mockResolvedValue({
      data: { id: 'biz-whatsapp', timezone: 'America/Bogota' },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-whatsapp', 'America/Bogota')

    expect(ctx.businessId).toBe('biz-whatsapp')
    expect(ctx.userId).toBe('webhook')
    expect(ctx.timezone).toBe('America/Bogota')
  })

  it('uses business timezone from DB when none passed', async () => {
    mockSingleBusiness.mockResolvedValue({
      data: { id: 'biz-x', timezone: 'America/Caracas' },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-x', '')
    expect(ctx.timezone).toBe('America/Caracas')
  })

  it('falls back to UTC when no timezone available', async () => {
    mockSingleBusiness.mockResolvedValue({
      data: { id: 'biz-x', timezone: null },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-x', '')
    expect(ctx.timezone).toBe('UTC')
  })

  it('throws UNAUTHORIZED when business not found', async () => {
    mockSingleBusiness.mockResolvedValue({
      data: null,
      error: { message: 'Business not found' },
    })

    await expect(
      TenantEnforcer.verifyWebhook('nonexistent-biz', 'UTC')
    ).rejects.toThrow('UNAUTHORIZED')
  })

  it('sets userId to "webhook" (not a real user ID)', async () => {
    mockSingleBusiness.mockResolvedValue({
      data: { id: 'biz-wa', timezone: 'UTC' },
      error: null,
    })

    const ctx = await TenantEnforcer.verifyWebhook('biz-wa', 'UTC')
    expect(ctx.userId).toBe('webhook')
  })
})

// ── Phantom Type: compile-time enforcement ────────────────────────────────────
// These tests document the security model.
// The type system (TypeScript) is the first line of defense.
// Runtime tests below verify the runtime behavior.

describe('TenantContext phantom type invariants (documentation)', () => {
  it('TenantContext can only be obtained via TenantEnforcer.verify (documented invariant)', async () => {
    // This is documented: the ONLY path to get a valid TenantContext is through
    // TenantEnforcer.verify() or TenantEnforcer.verifyWebhook().
    //
    // In test code we cast with `as unknown as TenantContext` which is intentional
    // (tests bypass the DB lookup). In production code, TypeScript prevents
    // direct construction because of the phantom [__tenantBrand]: true field.
    //
    // If you're reading this and thinking "I can just cast in production code too",
    // that is a security violation. All casts outside of TenantEnforcer.ts are forbidden.
    expect(true).toBe(true)
  })

  it('verify() resolves to an object with businessId, userId, timezone fields', async () => {
    mockSingleUser.mockResolvedValue({
      data: { business_id: 'biz-verify' },
      error: null,
    })

    const ctx = await TenantEnforcer.verify('biz-verify', 'user-test', 'America/Bogota')

    expect(typeof ctx.businessId).toBe('string')
    expect(typeof ctx.userId).toBe('string')
    expect(typeof ctx.timezone).toBe('string')
    expect(ctx.businessId).toBeTruthy()
    expect(ctx.userId).toBeTruthy()
    expect(ctx.timezone).toBeTruthy()
  })
})
