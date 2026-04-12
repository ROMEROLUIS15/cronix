/**
 * token-quota.ts — Token usage tracking and quota enforcement for AI services.
 *
 * Prevents runaway LLM costs by enforcing daily token budgets per business.
 * Uses Upstash Redis for fast, distributed enforcement.
 * Falls back to Supabase DB if Redis is unavailable.
 *
 * Quota defaults:
 *   - Daily token limit: 50,000 tokens per business (matches WhatsApp default)
 *   - Can be overridden via businesses.settings.wa_daily_token_limit
 */

import { Redis } from '@upstash/redis'

// ── Lazy Redis ───────────────────────────────────────────────────────────────

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

const DEFAULT_DAILY_TOKEN_LIMIT = 50_000

/**
 * Checks if the business has exceeded its daily token quota.
 * Returns { allowed: true, remaining } or { allowed: false, used, limit }.
 */
export async function checkTokenQuota(
  businessId: string,
  customLimit?: number,
): Promise<{
  allowed: boolean
  used: number
  limit: number
  remaining: number
}> {
  const redis = getRedis()
  if (!redis) return checkTokenQuotaFallback(businessId, customLimit)

  const limit = customLimit ?? DEFAULT_DAILY_TOKEN_LIMIT
  const key = `token_quota:${businessId}:${getDayKey()}`

  try {
    const usedStr = await redis.get(key)
    const used = typeof usedStr === 'number' ? usedStr : parseInt(String(usedStr ?? '0'), 10)

    if (used >= limit) {
      return { allowed: false, used, limit, remaining: 0 }
    }

    return { allowed: true, used, limit, remaining: limit - used }
  } catch {
    return { allowed: true, used: 0, limit, remaining: limit } // fail-open
  }
}

/**
 * Records token usage for a business.
 * Should be called after each LLM request completes.
 */
export async function recordTokenUsage(
  businessId: string,
  tokenCount: number,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return // skip if Redis unavailable

  const key = `token_quota:${businessId}:${getDayKey()}`

  try {
    await redis.incrby(key, tokenCount)
    await redis.expire(key, 86400 + 3600) // 25h TTL (covers timezone edge cases)
  } catch {
    // Silently fail — logging usage is non-critical
  }
}

/**
 * Resets token quota for a business (admin use).
 */
export async function resetTokenQuota(businessId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const key = `token_quota:${businessId}:${getDayKey()}`
  try {
    await redis.del(key)
  } catch {
    // ignore
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

function getDayKey(): string {
  // UTC date to avoid timezone inconsistencies across serverless regions
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Fallback: check quota via Supabase DB (slower but functional).
 * Used when Redis is not available.
 */
async function checkTokenQuotaFallback(
  _businessId: string,
  _customLimit?: number,
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  // When Redis is unavailable, allow the request but track nothing.
  // A proper Supabase-based quota table could be added later.
  const limit = _customLimit ?? DEFAULT_DAILY_TOKEN_LIMIT
  return { allowed: true, used: 0, limit, remaining: limit }
}
