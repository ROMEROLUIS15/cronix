/**
 * user-rate-limit.test.ts — Per-user rate limiting for cost-incurring routes.
 *
 * Mocks the underlying Redis sliding-window limiter so we assert only the
 * decision/response mapping owned by this module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedisRateLimit = vi.fn()
vi.mock('@/lib/rate-limit/redis-rate-limiter', () => ({
  redisRateLimit: (...args: unknown[]) => mockRedisRateLimit(...args),
}))

import {
  enforceUserRateLimit,
  isUserRateLimited,
  ASSISTANT_LIMITS,
} from '@/lib/rate-limit/user-rate-limit'

describe('user-rate-limit', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('enforceUserRateLimit', () => {
    it('returns null and forwards the config to Redis when the request is allowed', async () => {
      // Arrange
      mockRedisRateLimit.mockResolvedValueOnce({ allowed: true })

      // Act
      const res = await enforceUserRateLimit('user-1', ASSISTANT_LIMITS.tts)

      // Assert
      expect(res).toBeNull()
      expect(mockRedisRateLimit).toHaveBeenCalledWith(
        'user-1',
        ASSISTANT_LIMITS.tts.action,
        ASSISTANT_LIMITS.tts.limit,
        ASSISTANT_LIMITS.tts.windowSecs,
      )
    })

    it('returns a 429 with Retry-After when over budget', async () => {
      // Arrange
      mockRedisRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 42 })

      // Act
      const res = await enforceUserRateLimit('user-2', ASSISTANT_LIMITS.proactive)

      // Assert
      expect(res).not.toBeNull()
      expect(res!.status).toBe(429)
      expect(res!.headers.get('Retry-After')).toBe('42')
      const body = await res!.json()
      expect(body.error).toContain('42s')
    })

    it('falls back to the window length when Redis gives no retryAfter', async () => {
      // Arrange
      mockRedisRateLimit.mockResolvedValueOnce({ allowed: false })

      // Act
      const res = await enforceUserRateLimit('user-3', ASSISTANT_LIMITS.proactive)

      // Assert
      expect(res!.headers.get('Retry-After')).toBe(String(ASSISTANT_LIMITS.proactive.windowSecs))
    })
  })

  describe('isUserRateLimited', () => {
    it('returns false when allowed', async () => {
      mockRedisRateLimit.mockResolvedValueOnce({ allowed: true })
      expect(await isUserRateLimited('u', ASSISTANT_LIMITS.ttsFailure)).toBe(false)
    })

    it('returns true when blocked', async () => {
      mockRedisRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 5 })
      expect(await isUserRateLimited('u', ASSISTANT_LIMITS.ttsFailure)).toBe(true)
    })
  })
})
