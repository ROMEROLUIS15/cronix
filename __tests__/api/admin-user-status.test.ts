/**
 * app/api/admin/users/[id]/status — Admin User Status Update Tests
 *
 * Tests authorization, validation, and status transitions:
 * - Only platform_admin can call
 * - Cannot modify own status
 * - Valid status values (active | pending | rejected)
 * - Invalid status rejected
 * - Non-existent user error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/users/[id]/status/route'

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockAuthUser = { id: 'admin-user-123', email: 'admin@example.com' }
const mockTargetUser = { id: 'target-user-456', email: 'user@example.com' }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}))

import { createClient, createAdminClient } from '@/lib/supabase/server'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/users/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const request = new Request('http://localhost/api/admin/users/target-id/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-id' }),
    })

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 403 when caller is not platform_admin', async () => {
    const mockSupabase = {
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
              data: { role: 'owner' }, // Not admin
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const request = new Request('http://localhost/api/admin/users/target-id/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-id' }),
    })

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toBe('Forbidden')
  })

  it('updates user status when caller is platform_admin', async () => {
    const mockSupabase = {
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
              data: { role: 'platform_admin' },
              error: null,
            }),
          }),
        }),
      }),
    }

    const mockAdminClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'target-user-456', status: 'active', email: 'user@example.com' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any)

    const request = new Request('http://localhost/api/admin/users/target-user-456/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-user-456' }),
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.user.status).toBe('active')
  })

  it('returns 400 for invalid status value', async () => {
    const mockSupabase = {
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
              data: { role: 'platform_admin' },
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const request = new Request('http://localhost/api/admin/users/target-id/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'invalid_status' }),
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-id' }),
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toContain('Invalid status')
  })

  it('returns 400 when status is missing', async () => {
    const mockSupabase = {
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
              data: { role: 'platform_admin' },
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const request = new Request('http://localhost/api/admin/users/target-id/status', {
      method: 'PATCH',
      body: JSON.stringify({}), // No status
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-id' }),
    })

    expect(response.status).toBe(400)
  })

  it('returns 400 when trying to modify own status', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { ...mockAuthUser, id: 'same-user-id' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { role: 'platform_admin' },
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const request = new Request('http://localhost/api/admin/users/same-user-id/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'same-user-id' }),
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toContain('Cannot modify your own status')
  })

  it('returns 500 on database error', async () => {
    const mockSupabase = {
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
              data: { role: 'platform_admin' },
              error: null,
            }),
          }),
        }),
      }),
    }

    const mockAdminClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: new Error('Database connection failed'),
              }),
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any)

    const request = new Request('http://localhost/api/admin/users/target-id/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })

    const response = await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-id' }),
    })

    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json.error).toBeDefined()
  })

  it.each(['active', 'pending', 'rejected'] as const)(
    'returns 200 when platform_admin sets status to "%s"',
    async (status) => {
      // ── Arrange ───────────────────────────────────────────────────────────
      const mockSupabase = {
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
                data: { role: 'platform_admin' },
                error: null,
              }),
            }),
          }),
        }),
      }

      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'target-id', status, email: 'test@example.com' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }

      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any)

      const request = new Request(`http://localhost/api/admin/users/target-id/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })

      // ── Act ───────────────────────────────────────────────────────────────
      const response = await PATCH(request as NextRequest, {
        params: Promise.resolve({ id: 'target-id' }),
      })

      // ── Assert ────────────────────────────────────────────────────────────
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.user.status).toBe(status)
    }
  )

  it('sets updated_at timestamp when updating', async () => {
    const mockSupabase = {
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
              data: { role: 'platform_admin' },
              error: null,
            }),
          }),
        }),
      }),
    }

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'target-id', status: 'active' },
            error: null,
          }),
        }),
      }),
    })

    const mockAdminClient = {
      from: vi.fn().mockReturnValue({
        update: updateMock,
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any)

    const request = new Request('http://localhost/api/admin/users/target-id/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    })

    await PATCH(request as NextRequest, {
      params: Promise.resolve({ id: 'target-id' }),
    })

    // Verify updated_at was included
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        updated_at: expect.any(String),
      })
    )
  })
})
