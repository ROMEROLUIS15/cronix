/**
 * DashboardBookingAdapter.test.ts — Integration tests for the Dashboard adapter.
 *
 * Verifies:
 *   1. TenantEnforcer.verify failure → returns unauthorized without executing tools
 *   2. BookingEngine success → adapter returns success with BookingData
 *   3. BookingEngine failure → adapter returns error without throwing
 *   4. Cross-tenant businessId injection is caught by TenantEnforcer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardBookingAdapter } from '../dashboard/DashboardBookingAdapter'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/cache', () => ({
  default: {
    get:           vi.fn().mockResolvedValue(null),
    set:           vi.fn().mockResolvedValue(undefined),
    invalidate:    vi.fn().mockResolvedValue(undefined),
    invalidateKey: vi.fn().mockResolvedValue(undefined),
  },
}))

// Must not reference outer variables inside factory (vitest hoists vi.mock)
vi.mock('@/lib/ai/core/security/TenantEnforcer', () => ({
  TenantEnforcer: { verify: vi.fn() },
}))

vi.mock('@/lib/repositories', () => ({
  getRepos: vi.fn(() => ({
    appointments: {
      findConflicts:        vi.fn().mockResolvedValue({ data: [] }),
      create:               vi.fn().mockResolvedValue({ data: { id: 'apt-1', business_id: 'biz-a', client_id: 'c1', status: 'pending' } }),
      getDayAppointments:   vi.fn().mockResolvedValue({ data: [] }),
      getDaySlots:          vi.fn().mockResolvedValue({ data: [] }),
      getForEdit:           vi.fn().mockResolvedValue({ data: null }),
      findUpcomingByClient: vi.fn().mockResolvedValue({ data: [] }),
      findByDateRange:      vi.fn().mockResolvedValue({ data: [] }),
      getMonthAppointments: vi.fn().mockResolvedValue({ data: [] }),
      getDashboardStats:    vi.fn().mockResolvedValue({ data: {} }),
      updateStatus:         vi.fn().mockResolvedValue({ data: undefined }),
      reschedule:           vi.fn().mockResolvedValue({ data: undefined }),
    },
    clients: {
      findActiveForAI: vi.fn().mockResolvedValue({ data: [{ id: 'c1', name: 'Ana García', phone: null }] }),
      getById:         vi.fn().mockResolvedValue({ data: { id: 'c1', name: 'Ana García', phone: null } }),
      insert:          vi.fn().mockResolvedValue({ data: { id: 'c1', name: 'Ana García', phone: null } }),
      getAll:          vi.fn(),
      getAllForSelect:  vi.fn(),
      getAppointments: vi.fn(),
      findInactive:    vi.fn(),
    },
    services: {
      getActive:    vi.fn().mockResolvedValue({ data: [{ id: 's1', name: 'Manicura', duration_min: 45, price: 15000 }] }),
      getAll:       vi.fn(),
      hasAny:       vi.fn(),
      create:       vi.fn(),
      update:       vi.fn(),
      delete:       vi.fn(),
      toggleActive: vi.fn(),
      getById:      vi.fn(),
    },
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

// Get the mocked TenantEnforcer.verify after vi.mock has been applied
async function getMockVerify() {
  const mod = await import('@/lib/ai/core/security/TenantEnforcer')
  return mod.TenantEnforcer.verify as ReturnType<typeof vi.fn>
}

const mockSupabase = {} as SupabaseClient<any>

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DashboardBookingAdapter.execute', () => {
  let adapter: DashboardBookingAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    adapter = new DashboardBookingAdapter(mockSupabase)
  })

  it('returns unauthorized when TenantEnforcer throws', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockRejectedValue(new Error('UNAUTHORIZED: business_id no pertenece a este usuario'))

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana' },
      userId:     'attacker-user',
      businessId: 'biz-victim',
      timezone:   'UTC',
    })

    expect(result.success).toBe(false)
    expect(result.result.toLowerCase()).toContain('autorizado')
  })

  it('TenantEnforcer.verify is called with the exact businessId from the request', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockRejectedValue(new Error('UNAUTHORIZED'))

    await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    {},
      userId:     'attacker',
      businessId: 'victim-biz',
      timezone:   'UTC',
    })

    expect(mockVerify).toHaveBeenCalledWith('victim-biz', 'attacker', 'UTC')
  })

  it('returns success with message when engine succeeds', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockResolvedValue({
      businessId: 'biz-a',
      userId:     'user-1',
      timezone:   'America/Bogota',
    })

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    {
        service_id:  'Manicura',
        date:        '2026-05-10',
        time:        '10:00',
        client_name: 'Ana García',
      },
      userId:     'user-1',
      businessId: 'biz-a',
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(typeof result.result).toBe('string')
      expect(result.result.length).toBeGreaterThan(0)
    }
  })

  it('returns error (not throws) when engine receives invalid args', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockResolvedValue({
      businessId: 'biz-a',
      userId:     'user-1',
      timezone:   'UTC',
    })

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    {
        service_id: 'Manicura',
        date:       '2026-05-10',
        time:       '25:99', // Invalid → INVALID_ARGS from Zod
        client_name: 'Ana',
      },
      userId:     'user-1',
      businessId: 'biz-a',
      timezone:   'UTC',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.result.length).toBeGreaterThan(0)
  })

  it('read-only tool result has no data field', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockResolvedValue({
      businessId: 'biz-a',
      userId:     'user-1',
      timezone:   'America/Bogota',
    })

    const result = await adapter.execute({
      toolName:   'get_appointments_by_date',
      rawArgs:    { date: '2026-05-10' },
      userId:     'user-1',
      businessId: 'biz-a',
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBeUndefined()
    }
  })

  it('cross-tenant attack: businessId mismatch → unauthorized', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockRejectedValue(
      new Error('UNAUTHORIZED: business_id no pertenece a este usuario')
    )

    const result = await adapter.execute({
      toolName:   'cancel_booking',
      rawArgs:    { appointment_id: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1' },
      userId:     'attacker-user-id',
      businessId: 'biz-victim-id',
      timezone:   'UTC',
    })

    expect(result.success).toBe(false)
    expect(result.result.toLowerCase()).toContain('autorizado')
  })

  it('never throws — always returns ExecResult', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockRejectedValue(new Error('Completely unexpected error'))

    await expect(
      adapter.execute({
        toolName:   'confirm_booking',
        rawArgs:    {},
        userId:     'u',
        businessId: 'b',
        timezone:   'UTC',
      })
    ).resolves.toBeDefined()
  })

  it('result includes error code when unauthorized', async () => {
    const mockVerify = await getMockVerify()
    mockVerify.mockRejectedValue(new Error('UNAUTHORIZED'))

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    {},
      userId:     'user',
      businessId: 'biz',
      timezone:   'UTC',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
