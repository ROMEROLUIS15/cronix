/**
 * Auth Server Actions — Unit Tests
 *
 * Tests for lib/actions/auth.ts
 * Covers: login error mapping, Google OAuth URL generation, signout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  })

  describe('login', () => {
    it('redirects on successful login', async () => {
      mockSignIn.mockResolvedValue({ error: null })

      const formData = new FormData()
      formData.set('email', 'test@example.com')
      formData.set('password', 'password123')

      await login(formData)

      expect(redirect).toHaveBeenCalledWith('/dashboard')
    })

    it('returns generic error on wrong credentials', async () => {
      mockSignIn.mockResolvedValue({
        error: { message: 'Invalid login credentials' },
      })

      const formData = new FormData()
      formData.set('email', 'test@example.com')
      formData.set('password', 'wrong')

      const result = await login(formData)

      expect(result).toEqual({ error: 'Correo o contraseña incorrectos.' })
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
