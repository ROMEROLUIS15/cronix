/**
 * lib/auth/get-business-id.ts — Business ID Resolution Tests
 *
 * Tests getBusinessId() which extracts the current user's business context.
 * Critical for multi-tenant isolation and authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBusinessId } from '@/lib/auth/get-business-id'

// ── Mock Supabase ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// Mock React cache to avoid complexity in test environment
vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return {
    ...actual,
    cache: (fn: any) => fn,
  }
})

import { createClient } from '@/lib/supabase/server'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getBusinessId()', () => {
  const mockAuthUser = {
    id: 'user-123',
    email: 'test@example.com',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns business_id when user exists with valid business', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: mockAuthUser },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { business_id: 'biz-789' },
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const businessId = await getBusinessId()

    expect(businessId).toBe('biz-789')
  })

  it('returns null when user is not authenticated', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const businessId = await getBusinessId()

    expect(businessId).toBeNull()
  })

  it('returns null when user exists but has no business_id (incomplete setup)', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: mockAuthUser },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { business_id: null },
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const businessId = await getBusinessId()

    expect(businessId).toBeNull()
  })

  it('returns null when database query returns error', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: mockAuthUser },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: new Error('Query failed'),
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const businessId = await getBusinessId()

    expect(businessId).toBeNull()
  })

  it('queries the correct table and user ID', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { business_id: 'biz-123' },
          error: null,
        }),
      }),
    })

    const fromMock = vi.fn().mockReturnValue({ select: selectMock })

    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: mockAuthUser },
          error: null,
        }),
      },
      from: fromMock,
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    await getBusinessId()

    expect(fromMock).toHaveBeenCalledWith('users')
    expect(selectMock).toHaveBeenCalledWith('business_id')
  })

  it('handles auth error gracefully (returns null)', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Auth session expired'),
        }),
      },
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const businessId = await getBusinessId()

    expect(businessId).toBeNull()
  })
})
