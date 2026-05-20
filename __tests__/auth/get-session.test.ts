/**
 * lib/auth/get-session.ts — Session Retrieval Tests
 *
 * Tests the core getSession() function which authenticates all requests.
 * Validates that:
 * - Valid auth users are mapped to database records
 * - Missing database records return null (incomplete registration)
 * - Auth errors return null (security: don't leak partial state)
 * - DB errors return null (security: avoid RLS recursion issues)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSession, SessionUser } from '@/lib/auth/get-session'

// ── Mock Supabase ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { createClient } from '@/lib/supabase/server'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getSession()', () => {
  const mockAuthUser = {
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: {},
    aud: 'authenticated',
  }

  const mockDbUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'owner',
    status: 'active',
    business_id: 'biz-456',
    avatar_url: 'https://example.com/avatar.jpg',
    phone: '+1234567890',
    color: '#FF5733',
    provider: 'google',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-19T00:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns SessionUser with dbUser when both auth and DB user exist', async () => {
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
            maybeSingle: vi.fn().mockResolvedValue({
              data: mockDbUser,
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session).toBeDefined()
    expect(session?.id).toBe('user-123')
    expect(session?.email).toBe('test@example.com')
    expect(session?.dbUser).toEqual(mockDbUser)
    expect(session?.business_id).toBe('biz-456')
  })

  it('returns null when getUser() returns error', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Session expired'),
        }),
      },
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session).toBeNull()
  })

  it('returns null when getUser() returns no user', async () => {
    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session).toBeNull()
  })

  it('returns null when user exists in auth but not in DB (incomplete registration)', async () => {
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
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session).toBeNull()
  })

  it('returns null on DB error (security: prevent RLS recursion issues)', async () => {
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
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: new Error('Row Level Security (RLS) policy violation'),
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session).toBeNull()
  })

  it('returns null on critical exception (catch block)', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('Supabase connection failed'))

    const session = await getSession()

    expect(session).toBeNull()
  })

  it('preserves all auth user properties alongside dbUser', async () => {
    const authUserWithMetadata = {
      ...mockAuthUser,
      user_metadata: { avatar_url: 'https://example.com/meta-avatar.jpg' },
      app_metadata: { provider: 'google' },
    }

    const mockAuth = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: authUserWithMetadata },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: mockDbUser,
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session).toBeDefined()
    expect(session?.user_metadata).toBeDefined()
    expect(session?.app_metadata).toBeDefined()
  })

  it('correctly maps business_id from dbUser to root level', async () => {
    const dbUserWithNullBusinessId = { ...mockDbUser, business_id: null }

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
            maybeSingle: vi.fn().mockResolvedValue({
              data: dbUserWithNullBusinessId,
              error: null,
            }),
          }),
        }),
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockAuth as any)

    const session = await getSession()

    expect(session?.business_id).toBeNull()
    expect(session?.dbUser.business_id).toBeNull()
  })
})
