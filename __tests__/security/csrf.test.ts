/**
 * CSRF Security — Unit Tests
 *
 * Tests for lib/security/csrf.ts (Server Action helpers)
 * and lib/actions/csrf-action.ts (Server Action wrapper).
 *
 * NOTE: These tests mock Next.js `cookies()` and `headers()` from next/headers
 * which are async in Next.js 15.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Next.js headers ─────────────────────────────────────────────────────
const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
}
const mockHeaderStore = {
  get: vi.fn(),
}

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(mockCookieStore),
  headers: () => Promise.resolve(mockHeaderStore),
}))

// Import after mocking
import { generateCsrfToken, verifyCsrfToken, getCsrfToken, setCsrfCookie } from '@/lib/security/csrf'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CSRF Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generateCsrfToken', () => {
    it('generates a 64-character hex string', () => {
      const token = generateCsrfToken()
      expect(token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('generates unique tokens each call', () => {
      const t1 = generateCsrfToken()
      const t2 = generateCsrfToken()
      expect(t1).not.toBe(t2)
    })
  })

  describe('verifyCsrfToken', () => {
    it('passes when cookie and header tokens match', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'abc123' })
      mockHeaderStore.get.mockReturnValue('abc123')

      await expect(verifyCsrfToken()).resolves.toBeUndefined()
    })

    it('throws when cookie token is missing', async () => {
      mockCookieStore.get.mockReturnValue(undefined)
      mockHeaderStore.get.mockReturnValue('abc123')

      await expect(verifyCsrfToken()).rejects.toThrow('CSRF token validation failed')
    })

    it('throws when header token is missing', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'abc123' })
      mockHeaderStore.get.mockReturnValue(null)

      await expect(verifyCsrfToken()).rejects.toThrow('CSRF token validation failed')
    })

    it('throws when tokens do not match', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'abc123' })
      mockHeaderStore.get.mockReturnValue('xyz789')

      await expect(verifyCsrfToken()).rejects.toThrow('CSRF token validation failed')
    })
  })

  describe('setCsrfCookie', () => {
    it('sets cookie with provided token', async () => {
      await setCsrfCookie('my-token')

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'cronix_csrf_token',
        'my-token',
        expect.objectContaining({ httpOnly: false, sameSite: 'strict', path: '/' })
      )
    })

    it('generates a new token when none provided', async () => {
      await setCsrfCookie()

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'cronix_csrf_token',
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.any(Object)
      )
    })
  })

  describe('getCsrfToken', () => {
    it('returns existing token from cookie', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'existing-token' })

      const token = await getCsrfToken()
      expect(token).toBe('existing-token')
    })

    it('generates and sets new token when cookie is missing', async () => {
      mockCookieStore.get.mockReturnValue(undefined)

      const token = await getCsrfToken()
      expect(token).toMatch(/^[0-9a-f]{64}$/)
      expect(mockCookieStore.set).toHaveBeenCalled()
    })
  })
})
