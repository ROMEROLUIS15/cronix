/**
 * rate-limit-action.ts — Rate limiting wrapper for Server Actions.
 *
 * Uses Upstash Redis for distributed enforcement.
 * Falls back to in-memory limiter when Redis is unavailable.
 *
 * Usage:
 *   await withActionRateLimit('team-create', 10, 60, async () => {
 *     return createEmployeeAction(input)
 *   })
 */

import { redisRateLimit, isRedisAvailable } from '@/lib/rate-limit/redis-rate-limiter'
import { headers } from 'next/headers'

const inMemoryWindows = new Map<string, { count: number; resetAt: number }>()

/**
 * Extract client IP from Next.js headers() in Server Action context.
 * headers() is async in Next.js 15.
 */
async function getActionClientIP(): Promise<string> {
  const h = await headers()
  const xForwardedFor = h.get('x-forwarded-for')
  if (xForwardedFor) return xForwardedFor.split(',')[0]?.trim() || 'unknown'
  return h.get('x-real-ip') || '127.0.0.1'
}

/**
 * Enforces rate limiting for a Server Action.
 * @param actionName Unique identifier for the action (e.g., 'team-create')
 * @param maxRequests Maximum requests allowed per window
 * @param windowSecs Time window in seconds
 * @returns void, throws on rate limit exceeded
 */
export async function withActionRateLimit(
  actionName: string,
  maxRequests: number,
  windowSecs: number,
  fn: () => Promise<unknown>
): Promise<unknown> {
  const ip = await getActionClientIP()
  const key = `action:${actionName}`

  // Try Redis first (distributed enforcement)
  if (isRedisAvailable()) {
    const result = await redisRateLimit(ip, key, maxRequests, windowSecs)
    if (!result.allowed) {
      throw new Error(`Demasiadas solicitudes. Intente de nuevo en ${result.retryAfter}s.`)
    }
    return fn()
  }

  // Fallback: in-memory limiter (per-instance)
  const now = Date.now()
  const windowKey = `${ip}:${key}`
  const window = inMemoryWindows.get(windowKey)

  if (window && now < window.resetAt) {
    window.count++
    if (window.count > maxRequests) {
      const retryAfter = Math.ceil((window.resetAt - now) / 1000)
      throw new Error(`Demasiadas solicitudes. Intente de nuevo en ${retryAfter}s.`)
    }
  } else {
    inMemoryWindows.set(windowKey, { count: 1, resetAt: now + windowSecs * 1000 })
  }

  return fn()
}
