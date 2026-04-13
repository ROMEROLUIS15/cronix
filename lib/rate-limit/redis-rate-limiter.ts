/**
 * redis-rate-limiter.ts — Sliding window rate limiter using Upstash Redis.
 *
 * Uses sorted sets for O(log N) sliding window enforcement.
 * Works across all Vercel serverless instances (distributed).
 * Falls back to memory-based limiter if Redis is unavailable.
 */

import { Redis } from '@upstash/redis'

// ── Lazy singleton — only connects when Redis env vars are set ───────────────

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    _redis = new Redis({ url, token })
  }
  return _redis
}

/**
 * Checks rate limit via Redis sorted set sliding window.
 * Returns { allowed: true } if request passes, { allowed: false, retryAfter } if limited.
 *
 * Key format: `rl:{identifier}:{action}` — allows separate limits per action type.
 */
export async function redisRateLimit(
  identifier: string,
  action: string,
  limit: number,
  windowSecs: number,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const redis = getRedis()
  if (!redis) return { allowed: true } // fail-open if Redis not configured

  const key = `rl:${identifier}:${action}`
  const now = Date.now()
  const windowStart = now - windowSecs * 1000

  try {
    const tx = redis.multi()
    // Remove expired entries
    tx.zremrangebyscore(key, 0, windowStart)
    // Count remaining
    tx.zcard(key)
    const results = await tx.exec<[number, number]>()

    if (!results) return { allowed: true } // transaction failed → fail-open

    const [, count] = results

    if (count != null && count >= limit) {
      // Get oldest entry to calculate retry time
      const oldest = await redis.zrange(key, 0, 0, { rev: false })
      const retryAfter = oldest.length > 0
        ? Math.ceil((oldest[0] as number + windowSecs * 1000 - now) / 1000)
        : windowSecs

      return { allowed: false, retryAfter }
    }

    // Add current request
    await redis.zadd(key, { score: now, member: `${now}:${Math.random()}` })
    await redis.expire(key, windowSecs + 1)

    return { allowed: true }
  } catch {
    return { allowed: true } // fail-open on Redis errors
  }
}

/**
 * Checks if Redis rate limiting is available.
 */
export function isRedisAvailable(): boolean {
  return getRedis() !== null
}

/**
 * Marks a request key as seen using SET NX (set-if-not-exists).
 * Returns true if this key was already seen before (duplicate), false if it is new.
 * Fails open: returns false on any Redis error so the request is never blocked.
 *
 * Use for idempotent deduplication of one-shot operations (e.g. voice requests).
 * Key format convention: `<scope>:<userId>:<requestId>`
 */
export async function markRequestSeen(key: string, ttlSecs: number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    // SET NX returns 'OK' when the key was set (new), null when it already existed (duplicate).
    const result = await redis.set(key, '1', { nx: true, ex: ttlSecs })
    return result === null
  } catch {
    return false // fail-open
  }
}
