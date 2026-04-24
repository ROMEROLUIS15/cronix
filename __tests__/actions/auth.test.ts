/**
 * Auth Server Actions — Unit Tests
 *
 * Tests for lib/actions/auth.ts
 * Covers: login error mapping, Google OAuth URL generation, signout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock rate limiter (prevents Redis / in-memory state leaking between tests) ─
const mockGetLoginFailures    = vi.fn()
const mockIncrementFailures   = vi.fn()
const mockResetFailures       = vi.fn()

vi.mock('@/lib/rate-limit/redis-rate-limiter', () => ({
  getLoginFailures:      mockGetLoginFailures,
  incrementLoginFailures: mockIncrementFailures,
  resetLoginFailures:    mockResetFailures,
}))

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockSignIn = vi.fn()
const mockSignOut = vi.fn()
const mockOAuth = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignIn,
      signInWithOAuth: mockOAuth,
      signOut: mockSignOut,
    },
  }),
}))

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    redirect: vi.fn(),
  }
})

vi.mock('next/headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/headers')>()
  return {
    ...actual,
    headers: vi.fn().mockResolvedValue({ get: () => 'http://localhost:3000' }),
  }
})

// Import after mocking
import { login, signInWithGoogle, signUpWithGoogle, signout } from '@/lib/actions/auth'
import { redirect } from 'next/navigation'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Auth Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no prior failures, no lockout
    mockGetLoginFailures.mockResolvedValue(null)
    mockIncrementFailures.mockResolvedValue({ count: 1, firstFailAt: Date.now(), lastFailAt: Date.now() })
    mockResetFailures.mockResolvedValue(undefined)
  })

  describe('login', () => {
    it('redirects on successful login', async () => {
      mockSignIn.mockResolvedValue({ error: null })

      const formData = new FormData()
      formData.set('email', 'test@example.com')
      formData.set('password', 'password123')

      await login(formData)

      expect(redirect).toHaveBeenCalledWith('/dashboard')
      expect(mockResetFailures).toHaveBeenCalledWith('test@example.com')
    })

    it('returns invalid_credentials error on wrong password (first attempt)', async () => {
      mockSignIn.mockResolvedValue({
        error: { message: 'Invalid login credentials' },
      })
      mockIncrementFailures.mockResolvedValue({
        count: 1,
        firstFailAt: Date.now(),
        lastFailAt: Date.now(),
      })

      const formData = new FormData()
      formData.set('email', 'test@example.com')
      formData.set('password', 'wrong')

      const result = await login(formData)

      expect(result).toMatchObject({
        error: 'invalid_credentials',
        failedAttempts: 1,
      })
      expect(result?.lockoutEndsAt).toBeUndefined()
    })

    it('returns locked error after 3 failed attempts', async () => {
      const now = Date.now()
      mockSignIn.mockResolvedValue({
        error: { message: 'Invalid login credentials' },
      })
      mockIncrementFailures.mockResolvedValue({
        count: 3,
        firstFailAt: now - 10_000,
        lastFailAt: now,
      })

      const formData = new FormData()
      formData.set('email', 'test@example.com')
      formData.set('password', 'wrong')

      const result = await login(formData)

      expect(result).toMatchObject({
        error: 'locked',
        failedAttempts: 3,
      })
      expect(result?.lockoutEndsAt).toBeDefined()
    })

    it('blocks login immediately when account is already locked', async () => {
      const now = Date.now()
      mockGetLoginFailures.mockResolvedValue({
        count: 3,
        firstFailAt: now - 60_000,
        lastFailAt: now - 30_000, // 30s ago → still inside 5-min window
      })

      const formData = new FormData()
      formData.set('email', 'locked@example.com')
      formData.set('password', 'any')

      const result = await login(formData)

      // Supabase should NOT be called when already locked
      expect(mockSignIn).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        error: 'locked',
        failedAttempts: 3,
      })
    })

    it('returns email verification error when not confirmed', async () => {
      mockSignIn.mockResolvedValue({
        error: { message: 'Email not confirmed' },
      })

      const formData = new FormData()
      formData.set('email', 'unverified@example.com')
      formData.set('password', 'password123')

      const result = await login(formData)

      expect(result).toHaveProperty('error')
      expect(result!.error).toContain('verificar tu correo')
    })
  })

  describe('signInWithGoogle', () => {
    it('redirects to Google OAuth URL', async () => {
      mockOAuth.mockResolvedValue({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      })

      await signInWithGoogle()

      expect(redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth')
    })

    it('includes dashboard redirect for login flow', async () => {
      mockOAuth.mockResolvedValue({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      })

      await signInWithGoogle()

      expect(mockOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: expect.objectContaining({
          redirectTo: expect.stringContaining('/dashboard'),
        }),
      })
    })

    it('returns error when OAuth fails', async () => {
      mockOAuth.mockResolvedValue({
        data: { url: null },
        error: { message: 'OAuth provider error' },
      })

      const result = await signInWithGoogle()

      expect(result).toEqual({ error: 'OAuth provider error' })
    })
  })

  describe('signUpWithGoogle', () => {
    it('redirects without /dashboard in URL (signup flow)', async () => {
      mockOAuth.mockResolvedValue({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      })

      await signUpWithGoogle()

      expect(mockOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: expect.objectContaining({
          redirectTo: expect.not.stringContaining('/dashboard'),
        }),
      })
    })
  })

  describe('signout', () => {
    it('signs out and redirects to home', async () => {
      mockSignOut.mockResolvedValue({})

      await signout()

      expect(mockSignOut).toHaveBeenCalled()
      expect(redirect).toHaveBeenCalledWith('/')
    })
  })
})
