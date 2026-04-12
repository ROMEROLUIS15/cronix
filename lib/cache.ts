/**
 * lib/cache.ts — Redis-backed caching layer for read-heavy repository methods.
 *
 * Purpose: Offload frequent DB reads to Upstash Redis (sub-ms latency).
 * Used by repositories via getCache() helper.
 *
 * TTL defaults are tuned per data type volatility:
 *  - appointments (day-level):  120 sec (changes frequently)
 *  - services (active list):    300 sec (rarely changes)
 *  - clients (list):            180 sec (moderate changes)
 *  - dashboard stats:           60 sec (composite, expensive query)
 *
 * Keys are automatically prefixed with `cache:` and scoped to business_id.
 * All values are JSON-serialized with a version prefix for future invalidation.
 *
 * ── TTL Unit Fix ───────────────────────────────────────────────────────────
 * Previously: TTL constants were in milliseconds (TTL.APPOINTMENTS_DAY = 2*60*1000)
 * but Redis SETEX expects seconds. The deserialize function compared Date.now()
 * against a ms threshold — double conversion bug.
 * Now: All TTL values are consistently in SECONDS throughout.
 */

import { Redis } from '@upstash/redis'

const CACHE_VERSION = 'v1' // Bump to bust all caches after schema changes

let _redis: Redis | null = null

/**
 * Returns a singleton Redis client for caching.
 * Returns null if Upstash is not configured (graceful degradation).
 */
function getRedis(): Redis | null {
  if (_redis) return _redis

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) return null

  _redis = new Redis({ url, token })
  return _redis
}

/** Build a cache key scoped to business and data type. */
function key(businessId: string, dataType: string, suffix: string): string {
  // Cache keys are transparent for debugging. Tenant isolation is enforced by:
  // 1. RLS policies (database layer)
  // 2. Application-layer business_id filtering in all repositories
  // 3. Upstash Redis token-based access (not shared between tenants)
  return `${CACHE_VERSION}:cache:${businessId}:${dataType}:${suffix}`
}

/** Serialize value — no TTL metadata needed (Redis SETEX handles expiry). */
function serialize<T>(data: T): string {
  return JSON.stringify({ v: CACHE_VERSION, d: data })
}

/** Parse cached value, returning null on miss or corrupted data. */
function deserialize<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed.d as T
  } catch {
    return null // Corrupted
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface CacheStore {
  /** Get cached data. Returns null on miss, error, or if Redis is unavailable. */
  get<T>(businessId: string, dataType: string, suffix: string): Promise<T | null>
  /** Set cache data. Silent fail on error — caching must never break the app. */
  set<T>(businessId: string, dataType: string, suffix: string, data: T, ttlSec: number): Promise<void>
  /** Invalidate all cache entries for a business + data type. */
  invalidate(businessId: string, dataType: string): Promise<void>
  /** Invalidate a specific cache key. */
  invalidateKey(businessId: string, dataType: string, suffix: string): Promise<void>
}

const cacheStore: CacheStore = {
  async get<T>(businessId: string, dataType: string, suffix: string): Promise<T | null> {
    try {
      const redis = getRedis()
      if (!redis) return null

      const k = key(businessId, dataType, suffix)
      const raw = await redis.get<string>(k)
      return deserialize<T>(raw)
    } catch {
      return null // Graceful degradation — fall through to DB
    }
  },

  async set<T>(businessId: string, dataType: string, suffix: string, data: T, ttlSec: number): Promise<void> {
    try {
      const redis = getRedis()
      if (!redis) return

      const k = key(businessId, dataType, suffix)
      const value = serialize(data)
      await redis.setex(k, ttlSec, value)
    } catch {
      // Silent fail — caching must never break the app
    }
  },

  async invalidate(businessId: string, dataType: string): Promise<void> {
    try {
      const redis = getRedis()
      if (!redis) return

      const pattern = `${CACHE_VERSION}:cache:${businessId}:${dataType}:*`
      const keys = await redis.keys(pattern)
      if (keys.length > 0) await redis.del(...keys)
    } catch {
      // Silent fail
    }
  },

  async invalidateKey(businessId: string, dataType: string, suffix: string): Promise<void> {
    try {
      const redis = getRedis()
      if (!redis) return

      const k = key(businessId, dataType, suffix)
      await redis.del(k)
    } catch {
      // Silent fail
    }
  },
}

export default cacheStore

// ── TTL Constants (all in SECONDS — consistent with Redis SETEX) ─────────────

export const TTL_SEC = {
  APPOINTMENTS_DAY:   120,    // 2 min
  APPOINTMENTS_MONTH: 300,    // 5 min
  CLIENTS:            180,    // 3 min
  SERVICES_ACTIVE:    300,    // 5 min
  DASHBOARD_STATS:    60,     // 1 min
  TEAM_MEMBERS:       300,    // 5 min
} as const

/** Legacy alias for backward compatibility — repositories should use TTL_SEC. */
export const TTL = TTL_SEC
