/**
 * CSRF Server Action Wrapper — Unit Tests
 *
 * Tests for lib/actions/csrf-action.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Next.js headers ─────────────────────────────────────────────────────
const mockCookieStore = { get: vi.fn() }
const mockHeaderStore = { get: vi.fn() }

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(mockCookieStore),
  headers: () => Promise.resolve(mockHeaderStore),
}))

import { validateCsrfToken, withCsrf } from '@/lib/actions/csrf-action'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CSRF Server Action Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => { vi.restoreAllMocks() })

  describe('validateCsrfToken', () => {
    it('skips validation when no CSRF cookie exists (unauthenticated)', async () => {
      mockCookieStore.get.mockReturnValue(undefined)

      // Should not throw — unauthenticated users skip CSRF check
      await expect(validateCsrfToken()).resolves.toBeUndefined()
    })

    it('passes when cookie and header tokens match', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'token-abc' })
      mockHeaderStore.get.mockReturnValue('token-abc')

      await expect(validateCsrfToken()).resolves.toBeUndefined()
    })

    it('throws when cookie exists but header is missing', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'token-abc' })
      mockHeaderStore.get.mockReturnValue(null)

      await expect(validateCsrfToken()).rejects.toThrow('Token de seguridad inválido (CSRF)')
    })

    it('throws when tokens do not match', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'token-abc' })
      mockHeaderStore.get.mockReturnValue('token-xyz')

      await expect(validateCsrfToken()).rejects.toThrow('Token de seguridad inválido (CSRF)')
    })
  })

  describe('withCsrf wrapper', () => {
    it('calls the wrapped function when CSRF is valid', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'valid-token' })
      mockHeaderStore.get.mockReturnValue('valid-token')

      const fn = vi.fn().mockResolvedValue({ success: true })
      const wrapped = withCsrf(fn)

      const result = await wrapped('arg1', 'arg2')

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
      expect(result).toEqual({ success: true })
    })

    it('rejects when CSRF validation fails', async () => {
      mockCookieStore.get.mockReturnValue({ value: 'valid-token' })
      mockHeaderStore.get.mockReturnValue('wrong-token')

      const fn = vi.fn().mockResolvedValue({ success: true })
      const wrapped = withCsrf(fn)

      await expect(wrapped()).rejects.toThrow('Token de seguridad inválido (CSRF)')
      expect(fn).not.toHaveBeenCalled()
    })
  })
})
