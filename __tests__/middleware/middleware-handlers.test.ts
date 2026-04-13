/**
 * Middleware Handlers — Unit Tests
 *
 * Tests each middleware handler in isolation:
 *  - with-request-id
 *  - with-csrf
 *  - with-rate-limit (mocked Redis)
 *  - with-session-timeout
 *  - with-user-status
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

// ── Mock Supabase SSR ───────────────────────────────────────────────────────
const mockSignOut = vi.fn().mockResolvedValue({})
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { signOut: mockSignOut },
    from: () => ({
      select: () => ({
        eq: () => ({ single: vi.fn().mockResolvedValue({ data: null }) }),
      }),
    }),
  }),
}))

// ── Mock Redis rate limiter ─────────────────────────────────────────────────
vi.mock('@/lib/rate-limit/redis-rate-limiter', () => ({
  redisRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  isRedisAvailable: vi.fn().mockReturnValue(false),
}))

// ── Mock in-memory rate limiter ─────────────────────────────────────────────
vi.mock('@/lib/api/rate-limit', () => ({
  assistantRateLimiter: { isRateLimited: vi.fn().mockReturnValue({ limited: false, retryAfter: 0 }) },
  generalRateLimiter: { isRateLimited: vi.fn().mockReturnValue({ limited: false, retryAfter: 0 }) },
  writeToolRateLimiter: { isRateLimited: vi.fn().mockReturnValue({ limited: false, retryAfter: 0 }) },
  WRITE_TOOLS: new Set(['book_appointment']),
}))

// ── Mock routing ─────────────────────────────────────────────────────────────
vi.mock('@/i18n/routing', () => ({
  routing: { locales: ['es', 'en', 'pt'], defaultLocale: 'es' },
}))

// ── Request factory ──────────────────────────────────────────────────────────
function makeRequest(overrides: { pathname?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const pathname = overrides.pathname ?? '/dashboard'
  const url = new URL(`https://example.com${pathname}`)
  const cookieStore = new Map(Object.entries(overrides.cookies ?? {}))

  const mockNextUrl = url as any
  mockNextUrl.pathname = pathname
  mockNextUrl.clone = () => {
    const cloned = new URL(`https://example.com${pathname}`) as any
    cloned.pathname = pathname
    return cloned
  }

  return {
    nextUrl: mockNextUrl,
    headers: new Headers(Object.entries(overrides.headers ?? {})),
    cookies: {
      getAll: () => Array.from(cookieStore.entries()).map(([name, value]) => ({ name, value })),
      get: (name: string) => cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
      has: (name: string) => cookieStore.has(name),
      set: (name: string, value: string) => cookieStore.set(name, value),
    } as any,
  } as unknown as any
}

function makeResponse() {
  const res = NextResponse.next()
  return res
}

const noop = () => Promise.resolve(NextResponse.next())

// ── Import middleware after mocks ───────────────────────────────────────────
import { withRequestId } from '@/lib/middleware/with-request-id'
import { withCsrf } from '@/lib/middleware/with-csrf'
import { withRateLimit } from '@/lib/middleware/with-rate-limit'
import { withSessionTimeout } from '@/lib/middleware/with-session-timeout'
import { withUserStatus } from '@/lib/middleware/with-user-status'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('withRequestId', () => {
  it('sets x-request-id header on the response', async () => {
    const req = makeRequest()
    const res = makeResponse()
    const result = await withRequestId(req, res, noop)

    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]+$/)
    expect(result).toBeNull()
  })
})

describe('withCsrf', () => {
  it('does not set CSRF cookie for unauthenticated requests', async () => {
    const req = makeRequest()
    const res = makeResponse()
    const result = await withCsrf(req, res, noop)

    expect(res.headers.getSetCookie()).not.toContain(
      expect.stringContaining('cronix_csrf_token')
    )
    expect(result).toBeNull()
  })

  it('sets CSRF cookie for authenticated requests', async () => {
    const req = makeRequest()
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')

    const result = await withCsrf(req, res, noop)

    const cookies = res.headers.getSetCookie()
    expect(cookies.length).toBeGreaterThan(0)
    expect(cookies[0]).toContain('cronix_csrf_token')
    expect(result).toBeNull()
  })

  it('reuses existing CSRF token from request cookie', async () => {
    const req = makeRequest({ cookies: { cronix_csrf_token: 'existing-token' } })
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')

    await withCsrf(req, res, noop)

    const cookies = res.headers.getSetCookie()
    expect(cookies[0]).toContain('existing-token')
  })
})

describe('withRateLimit', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('skips non-auth and non-API paths', async () => {
    const req = makeRequest({ pathname: '/dashboard' })
    const result = await withRateLimit(req, makeResponse(), noop)

    expect(result).toBeNull()
  })

  it('skips ping endpoint', async () => {
    const req = makeRequest({ pathname: '/api/activity/ping' })
    const result = await withRateLimit(req, makeResponse(), noop)

    expect(result).toBeNull()
  })

  it('processes login path (auth rate limit)', async () => {
    const req = makeRequest({ pathname: '/login' })
    const result = await withRateLimit(req, makeResponse(), noop)

    // Not rate limited (fresh IP)
    expect(result).toBeNull()
  })

  it('processes API path (api rate limit)', async () => {
    const req = makeRequest({ pathname: '/api/health' })
    const result = await withRateLimit(req, makeResponse(), noop)

    expect(result).toBeNull()
  })
})

describe('withSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-11T12:00:00Z'))
    vi.clearAllMocks()
  })

  afterEach(() => { vi.useRealTimers() })

  it('skips for unauthenticated users', async () => {
    const req = makeRequest({ pathname: '/dashboard' })
    const res = makeResponse()
    const result = await withSessionTimeout(req, res, noop)

    expect(result).toBeNull()
  })

  it('skips for non-tracked paths', async () => {
    const req = makeRequest({ pathname: '/api/something' })
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')
    const result = await withSessionTimeout(req, res, noop)

    expect(result).toBeNull()
  })

  it('stamps activity cookie for active session', async () => {
    const req = makeRequest({
      pathname: '/dashboard',
      cookies: {
        cronix_last_activity: String(Date.now()),
        cronix_session_start: String(Date.now()),
      },
    })
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')

    const result = await withSessionTimeout(req, res, noop)

    expect(result).toBeNull()
    const cookies = res.headers.getSetCookie()
    expect(cookies.some(c => c.includes('cronix_last_activity'))).toBe(true)
  })
})

describe('withUserStatus', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('skips for unauthenticated users', async () => {
    const req = makeRequest({ pathname: '/dashboard' })
    const result = await withUserStatus(req, makeResponse(), noop)

    expect(result).toBeNull()
  })

  it('skips for non-dashboard paths', async () => {
    const req = makeRequest({ pathname: '/settings' })
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')
    const result = await withUserStatus(req, res, noop)

    expect(result).toBeNull()
  })

  it('blocks rejected user when cached status is "rejected"', async () => {
    const req = makeRequest({
      pathname: '/dashboard',
      cookies: { cronix_user_status: 'rejected' },
    })
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')

    const result = await withUserStatus(req, res, noop)

    expect(result).not.toBeNull()
    expect(result?.status).toBe(307)
    expect(result?.headers.get('location')).toContain('account_blocked')
  })

  it('allows active user when cached status is "active"', async () => {
    const req = makeRequest({
      pathname: '/dashboard',
      cookies: { cronix_user_status: 'active' },
    })
    const res = makeResponse()
    res.headers.set('x-user-id', 'user-123')

    const result = await withUserStatus(req, res, noop)

    expect(result).toBeNull()
  })
})
