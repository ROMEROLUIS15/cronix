/**
 * with-rate-limit.ts — Distributed rate limiting for auth and API paths.
 *
 * Priority: Upstash Redis (distributed) → In-memory fallback (per-instance).
 * Eliminates the Supabase DB round-trip from the middleware chain.
 */

import { type NextRequest, NextResponse } from 'next/server'
import type { MiddlewareFn } from './compose'
import { redisRateLimit, isRedisAvailable } from '@/lib/rate-limit/redis-rate-limiter'
import {
  AUTH_RATE_LIMIT_MS,
  MAX_AUTH_ATTEMPTS,
  API_RATE_LIMIT_MS,
  MAX_API_REQUESTS,
} from './constants'
import { getClientIP } from './utils'

export const withRateLimit: MiddlewareFn = async (req, _res, next) => {
  const pathname = req.nextUrl.pathname

  const isAuthPath = ['/login', '/register', '/forgot-password', '/reset-password'].includes(pathname)
  const isApiPath = pathname.startsWith('/api/') && pathname !== '/api/activity/ping'

  if (!isAuthPath && !isApiPath) return null

  const ip = getClientIP(req)
  const action = isAuthPath ? 'auth' : 'api'
  const limit = isAuthPath ? MAX_AUTH_ATTEMPTS : MAX_API_REQUESTS
  const windowSecs = (isAuthPath ? AUTH_RATE_LIMIT_MS : API_RATE_LIMIT_MS) / 1000

  // Try Redis first (distributed enforcement)
  if (isRedisAvailable()) {
    const result = await redisRateLimit(ip, action, limit, windowSecs)
    if (!result.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${result.retryAfter}s.` },
        { status: 429 },
      )
    }
    return null
  }

  // Fallback: in-memory limiter (per-instance, still effective against burst abuse)
  const { assistantRateLimiter, generalRateLimiter } = await import('@/lib/api/rate-limit')
  const limiter = isAuthPath ? assistantRateLimiter : generalRateLimiter
  const { limited, retryAfter } = limiter.isRateLimited(ip)

  if (limited) {
    return NextResponse.json(
      { error: `Too many requests. Please try again in ${retryAfter}s.` },
      { status: 429 },
    )
  }

  return null
}
