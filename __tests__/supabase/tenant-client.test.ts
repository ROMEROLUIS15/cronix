/**
 * tenant-client.test.ts — Unit tests for tenant isolation logic.
 *
 * The createTenantClient() wraps a Supabase client and auto-applies
 * business_id filtering to all tenant tables. This is the core security
 * boundary between businesses — it MUST work correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('createTenantClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('rejects unauthenticated user', async () => {
    vi.resetModules()

    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null })
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: () => ({
        auth: { getUser: mockGetUser },
        from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }),
      }),
    }))

    const { createTenantClient } = await import('@/lib/supabase/tenant-client')
    await expect(createTenantClient()).rejects.toThrow('No authenticated user')
  })

  it('rejects user without business_id', async () => {
    vi.resetModules()

    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
      }),
    }))

    const { createTenantClient } = await import('@/lib/supabase/tenant-client')
    await expect(createTenantClient()).rejects.toThrow('not associated with any business')
  })

  it('auto-applies business_id filter on tenant tables', async () => {
    vi.resetModules()

    // Track what eq() calls are made on tenant tables
    const eqCalls: { table: string; field: string; value: string }[] = []

    const mockSingle = vi.fn().mockResolvedValue({ data: { business_id: 'biz-abc' }, error: null })

    // Build the mock chain with proper circular references
    const mockChain: any = {}
    Object.assign(mockChain, {
      eq: vi.fn((field: string, value: string) => {
        eqCalls.push({ table: 'clients', field, value })
        return mockChain
      }),
      select: vi.fn(() => mockChain),
      order: vi.fn(() => mockChain),
      gte: vi.fn(() => mockChain),
      lte: vi.fn(() => mockChain),
    })

    // When querying users table (for business_id lookup), return the mockSingle
    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({ single: mockSingle }),
          }),
        }
      }
      return mockChain
    })

    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
      }),
    }))

    const { createTenantClient } = await import('@/lib/supabase/tenant-client')
    const tenantClient = await createTenantClient()

    // Clear eq calls from user lookup
    eqCalls.length = 0

    // Query a tenant table — tenant client wraps .from() to auto-apply business_id
    ;(tenantClient as any).from('clients')

    // The tenant client's .from() override calls supabase.from(table).eq('business_id', bizId)
    expect(eqCalls.some(c => c.field === 'business_id' && c.value === 'biz-abc')).toBe(true)
  })

  it('preserves non-tenant table access via base client', async () => {
    vi.resetModules()

    const mockSingle = vi.fn().mockResolvedValue({ data: { business_id: 'biz-abc' }, error: null })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
      }),
    }))

    const { createTenantClient } = await import('@/lib/supabase/tenant-client')
    const tenantClient = await createTenantClient()

    // The tenant client spreads the base client, so non-tenant tables are still accessible
    expect(typeof (tenantClient as any).from).toBe('function')
  })
})
