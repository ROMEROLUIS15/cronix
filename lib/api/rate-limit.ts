/**
 * Simple Memory-based Sliding Window Rate Limiter.
 * Useful for Vercel/Next.js protection when Redis is not available.
 * 
 * NOTE: On Serverless, this is partially shared across warm starts of the same Lambda.
 */
interface RateLimitRecord {
  timestamps: number[]
}

class MemoryRateLimiter {
  private cache: Map<string, RateLimitRecord> = new Map()
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  isRateLimited(identifier: string): { limited: boolean; retryAfter: number } {
    const now = Date.now()
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

  // Cleanup to avoid memory leaks
  cleanup() {
    const now = Date.now()
    for (const [key, record] of this.cache.entries()) {
      record.timestamps = record.timestamps.filter((t) => now - t < this.windowMs)
      if (record.timestamps.length === 0) {
        this.cache.delete(key)
      }
    }
  }
}

// Singletons for common limits
export const assistantRateLimiter = new MemoryRateLimiter(10, 60 * 1000) // 10 per min
export const generalRateLimiter   = new MemoryRateLimiter(30, 60 * 1000) // 30 per min
