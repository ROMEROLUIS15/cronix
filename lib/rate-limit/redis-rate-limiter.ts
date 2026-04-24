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
// ── Login failure tracking ────────────────────────────────────────────────────
// Key format: `lf:{email}` — isolated per account, not per IP.
// Each key stores a JSON string: { count: number; firstFailAt: number }
// TTL resets on each new failure; cleared on successful login.

const LOGIN_FAIL_TTL_SECS = 5 * 60  // 5-minute lockout window
const LOGIN_FAIL_KEY_PREFIX = 'lf:'

interface LoginFailState {
  count: number
  firstFailAt: number
  lastFailAt: number
}

// In-memory fallback for when Redis is not configured (per-instance only)
const _inMemoryFailures = new Map<string, LoginFailState & { expiresAt: number }>()

function _getInMemoryFail(email: string): LoginFailState | null {
  const entry = _inMemoryFailures.get(email)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _inMemoryFailures.delete(email)
    return null
  }
  return { count: entry.count, firstFailAt: entry.firstFailAt, lastFailAt: entry.lastFailAt }
}

/**
 * Increment failed login attempts for an email.
 * Returns the updated failure state ({ count, firstFailAt, lastFailAt }).
 * TTL is renewed on each call to maintain a sliding window from the last failure.
 */
export async function incrementLoginFailures(email: string): Promise<LoginFailState> {
  const key = `${LOGIN_FAIL_KEY_PREFIX}${email.toLowerCase()}`
  const now = Date.now()
  const redis = getRedis()

  if (redis) {
    try {
      const raw = await redis.get<string>(key)
      const existing: LoginFailState = raw
        ? (JSON.parse(raw) as LoginFailState)
        : { count: 0, firstFailAt: now, lastFailAt: now }

      const updated: LoginFailState = {
        count: existing.count + 1,
        firstFailAt: existing.firstFailAt,
        lastFailAt: now,
      }

      await redis.set(key, JSON.stringify(updated), { ex: LOGIN_FAIL_TTL_SECS })
      return updated
    } catch {
      return { count: 1, firstFailAt: now, lastFailAt: now }
    }
  }

  // In-memory fallback
  const existing = _getInMemoryFail(email) ?? { count: 0, firstFailAt: now, lastFailAt: now }
  const updated: LoginFailState = {
    count: existing.count + 1,
    firstFailAt: existing.firstFailAt,
    lastFailAt: now,
  }
  _inMemoryFailures.set(email, { ...updated, expiresAt: now + LOGIN_FAIL_TTL_SECS * 1000 })
  return updated
}

/**
 * Reset the failed login counter for an email (call after a successful login).
 */
export async function resetLoginFailures(email: string): Promise<void> {
  const key = `${LOGIN_FAIL_KEY_PREFIX}${email.toLowerCase()}`
  const redis = getRedis()
  if (redis) {
    try { await redis.del(key) } catch { /* fail silently */ }
  }
  _inMemoryFailures.delete(email)
}

/**
 * Get the current failure state for an email WITHOUT modifying it.
 * Returns null if no active lockout exists.
 */
export async function getLoginFailures(email: string): Promise<LoginFailState | null> {
  const key = `${LOGIN_FAIL_KEY_PREFIX}${email.toLowerCase()}`
  const redis = getRedis()

  if (redis) {
    try {
      const raw = await redis.get<string>(key)
      if (!raw) return null
      return JSON.parse(raw) as LoginFailState
    } catch {
      return null
    }
  }

  return _getInMemoryFail(email)
}

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
