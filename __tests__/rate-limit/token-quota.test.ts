/**
 * Token Quota — Unit Tests
 *
 * Tests for lib/rate-limit/token-quota.ts
 * Covers: token counting, quota enforcement, expiry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Redis ───────────────────────────────────────────────────────────────
const mockGet = vi.fn()
const mockIncrby = vi.fn()
const mockExpire = vi.fn()
const mockDel = vi.fn()

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: mockGet,
    incrby: mockIncrby,
    expire: mockExpire,
    del: mockDel,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))

// Mock env vars for Redis initialization
vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://localhost:8000')
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')

import { checkTokenQuota, recordTokenUsage, resetTokenQuota } from '@/lib/rate-limit/token-quota'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Token Quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue(null)
    mockIncrby.mockResolvedValue(1)
    mockExpire.mockResolvedValue(true)
    mockDel.mockResolvedValue(1)
  })

  describe('checkTokenQuota', () => {
    it('allows usage when under limit', async () => {
      mockGet.mockResolvedValue(1000) // 1000 tokens used

      const result = await checkTokenQuota('biz-123', 50000)

      expect(result.allowed).toBe(true)
      expect(result.used).toBe(1000)
      expect(result.remaining).toBe(49000)
    })

    it('blocks usage when quota exceeded', async () => {
      mockGet.mockResolvedValue(50001) // Over limit

      const result = await checkTokenQuota('biz-123', 50000)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('uses default limit when custom not provided', async () => {
      mockGet.mockResolvedValue(0)

      const result = await checkTokenQuota('biz-123')

      expect(result.limit).toBe(50000)
      expect(result.allowed).toBe(true)
    })

    it('fails open when Redis errors', async () => {
      mockGet.mockRejectedValue(new Error('Redis down'))

      const result = await checkTokenQuota('biz-123')

      expect(result.allowed).toBe(true)
      expect(result.used).toBe(0)
    })

    it('allows when Redis is unavailable', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '')

      const result = await checkTokenQuota('biz-123')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(50000)

      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://localhost:8000')
    })
  })

  describe('recordTokenUsage', () => {
    it('increments token count', async () => {
      await recordTokenUsage('biz-123', 1500)

      expect(mockIncrby).toHaveBeenCalled()
      expect(mockExpire).toHaveBeenCalled()
    })

    it('silently fails when Redis errors', async () => {
      mockIncrby.mockRejectedValue(new Error('Redis down'))

      await expect(recordTokenUsage('biz-123', 500)).resolves.toBeUndefined()
    })
  })

  describe('resetTokenQuota', () => {
    it('deletes quota key', async () => {
      await resetTokenQuota('biz-123')

      expect(mockDel).toHaveBeenCalled()
    })
  })
})
