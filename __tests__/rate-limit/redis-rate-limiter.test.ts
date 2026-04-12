/**
 * redis-rate-limiter.test.ts — Unit tests for Upstash Redis rate limiter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Upstash Redis ──────────────────────────────────────────────────────
const mockZremrangebyscore = vi.fn()
const mockZcard = vi.fn()
const mockZadd = vi.fn()
const mockExpire = vi.fn()
const mockZrange = vi.fn()
const mockMultiExec = vi.fn()
const mockMulti = vi.fn(() => ({
  zremrangebyscore: mockZremrangebyscore,
  zcard: mockZcard,
  exec: mockMultiExec,
}))
const mockGet = vi.fn()
const mockIncrby = vi.fn()
const mockDel = vi.fn()

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    zremrangebyscore: mockZremrangebyscore,
    zcard: mockZcard,
    zadd: mockZadd,
    expire: mockExpire,
    zrange: mockZrange,
    get: mockGet,
    incrby: mockIncrby,
    del: mockDel,
    multi: mockMulti,
  })),
}))

describe('redis-rate-limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('redisRateLimit', () => {
    it('allows request when under limit', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
      mockMultiExec.mockResolvedValue([0, 2]) // 2 requests in window

      const { redisRateLimit } = await import('@/lib/rate-limit/redis-rate-limiter')
      const result = await redisRateLimit('user-123', 'auth', 5, 60)

      expect(result.allowed).toBe(true)
    })

    it('blocks request when over limit', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'

      const now = Date.now()
      vi.setSystemTime(now)
      mockMultiExec.mockResolvedValue([0, 5]) // 5 requests = at limit
      mockZrange.mockResolvedValue([now - 30000]) // oldest entry 30s ago

      const { redisRateLimit } = await import('@/lib/rate-limit/redis-rate-limiter')
      const result = await redisRateLimit('user-123', 'auth', 5, 60)

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBe(30) // 60s window - 30s elapsed = 30s remaining
      vi.useRealTimers()
    })

    it('fails open when Redis is unavailable', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN

      const { redisRateLimit } = await import('@/lib/rate-limit/redis-rate-limiter')
      const result = await redisRateLimit('user-123', 'auth', 5, 60)

      expect(result.allowed).toBe(true)
    })
  })

  describe('token-quota', () => {
    beforeEach(() => {
      vi.resetModules()
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    })

    it('allows request when under quota', async () => {
      mockGet.mockResolvedValue(10000) // 10K used

      const { checkTokenQuota } = await import('@/lib/rate-limit/token-quota')
      const result = await checkTokenQuota('biz-123')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(40000) // 50K default - 10K
    })

    it('blocks request when over quota', async () => {
      mockGet.mockResolvedValue(60000) // 60K used, over 50K limit

      const { checkTokenQuota } = await import('@/lib/rate-limit/token-quota')
      const result = await checkTokenQuota('biz-123')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('records token usage via Redis', async () => {
      mockIncrby.mockResolvedValue(60000)
      mockExpire.mockResolvedValue(1)

      const { recordTokenUsage } = await import('@/lib/rate-limit/token-quota')
      await recordTokenUsage('biz-123', 5000)

      expect(mockIncrby).toHaveBeenCalled()
      expect(mockExpire).toHaveBeenCalled()
    })

    it('fails open when Redis is unavailable', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN

      vi.resetModules()

      const { checkTokenQuota } = await import('@/lib/rate-limit/token-quota')
      const result = await checkTokenQuota('biz-123')

      expect(result.allowed).toBe(true)
    })
  })
})
