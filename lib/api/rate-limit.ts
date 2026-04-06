/**
 * Sliding Window Rate Limiter — In-Memory with bounded cache.
 *
 * Limitation: In serverless environments (Vercel), each Lambda instance has its own
 * in-memory state. Limits are enforced per-instance, not globally across instances.
 * For global enforcement, migrate to Upstash Redis (@upstash/redis) and set
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in your environment.
 *
 * Current behavior: effective against single-source burst abuse on warm instances.
 * Adequate for most production traffic patterns; upgrade to Redis at >1k RPM.
 */
interface RateLimitRecord {
  timestamps: number[]
}

// Safety cap: prevent unbounded Map growth if identifiers keep cycling (e.g. enumeration attacks)
const MAX_CACHE_SIZE = 5_000

class MemoryRateLimiter {
  private cache: Map<string, RateLimitRecord> = new Map()
  private readonly limit: number
  private readonly windowMs: number
  private checkCount = 0

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  isRateLimited(identifier: string): { limited: boolean; retryAfter: number } {
    const now = Date.now()

    // Probabilistic cleanup: run full sweep every ~200 requests to evict stale entries
    this.checkCount++
    if (this.checkCount % 200 === 0) {
      this._cleanup(now)
    }

    // Hard cap: evict oldest entry when cache is full (LRU-lite)
    if (!this.cache.has(identifier) && this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }

    let record = this.cache.get(identifier)
    if (!record) {
      record = { timestamps: [] }
      this.cache.set(identifier, record)
    }

    // Filter timestamps within the current window
    record.timestamps = record.timestamps.filter((t) => now - t < this.windowMs)

    if (record.timestamps.length >= this.limit) {
      const oldestTimestamp = record.timestamps[0]!
      const retryAfter = Math.ceil((oldestTimestamp + this.windowMs - now) / 1000)
      return { limited: true, retryAfter }
    }

    record.timestamps.push(now)
    return { limited: false, retryAfter: 0 }
  }

  private _cleanup(now: number) {
    for (const [key, record] of this.cache.entries()) {
      record.timestamps = record.timestamps.filter((t) => now - t < this.windowMs)
      if (record.timestamps.length === 0) {
        this.cache.delete(key)
      }
    }
  }
}

// Singletons for common limits
export const assistantRateLimiter = new MemoryRateLimiter(10, 60 * 1000)  // 10 per min
export const generalRateLimiter   = new MemoryRateLimiter(30, 60 * 1000)  // 30 per min

// WRITE operations rate limiter: more strict than general.
// Prevents automated abuse of state-mutating tools (booking, cancellation, payments).
// Limits: 20 write operations per hour per authenticated user.
export const writeToolRateLimiter = new MemoryRateLimiter(20, 60 * 60 * 1000) // 20 per hour

/**
 * Set of tool names that mutate state in the database.
 * These tools are subject to stricter rate limiting than read-only tools.
 */
export const WRITE_TOOLS = new Set([
  'book_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'register_payment',
  'create_client',
  'send_reactivation_message',
])
