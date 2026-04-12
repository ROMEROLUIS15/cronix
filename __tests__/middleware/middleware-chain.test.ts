/**
 * middleware-chain.test.ts — Unit tests for the decomposed middleware.
 *
 * Each middleware is tested in isolation using the compose() utility.
 * Mocks Supabase SDK, NextResponse, and crypto.randomUUID.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type NextRequest, NextResponse } from 'next/server'

// ── Mock crypto ──────────────────────────────────────────────────────────────
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-123' })

// ── Mock Supabase SSR SDK ────────────────────────────────────────────────────
const mockGetUser = vi.fn()
const mockSignOut = vi.fn()
const mockFromSelectEqSingle = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => {
    const chain = {
      select: () => ({
        eq: () => ({
          single: mockFromSelectEqSingle,
        }),
      }),
    }
    return {
      auth: { getUser: mockGetUser, signOut: mockSignOut },
      from: () => chain,
      rpc: vi.fn(),
    }
  },
}))

// ── Mock i18n routing ───────────────────────────────────────────────────────
vi.mock('@/i18n/routing', () => ({
  routing: {
    locales: ['es', 'en', 'pt'],
    defaultLocale: 'es',
  },
}))

// ── Mock next-intl middleware ────────────────────────────────────────────────
vi.mock('next-intl/middleware', () => ({
  default: () => NextResponse.next(),
}))

// ── Request factory ──────────────────────────────────────────────────────────
function makeRequest(overrides: {
  pathname?: string
  cookies?: Record<string, string>
  headers?: Record<string, string>
} = {}): NextRequest {
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
  } as unknown as NextRequest
}

// ── Middleware imports (after mocks) ─────────────────────────────────────────
import { compose } from '@/lib/middleware/compose'
import { withRequestId } from '@/lib/middleware/with-request-id'
import { withSession } from '@/lib/middleware/with-session'
import { withUserStatus } from '@/lib/middleware/with-user-status'
import { withSessionTimeout } from '@/lib/middleware/with-session-timeout'
import { withRateLimit } from '@/lib/middleware/with-rate-limit'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('withRequestId', () => {
  it('adds x-request-id header to every response', async () => {
    const req = makeRequest({ pathname: '/dashboard' })
    const handler = compose(withRequestId)
    const res = await handler(req)

    expect(res.headers.get('x-request-id')).toBe('test-uuid-123')
  })
})

describe('withSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects unauthenticated user from /dashboard to /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const req = makeRequest({ pathname: '/dashboard' })
    const handler = compose(withSession)
    const res = await handler(req)

    // Redirect — check location header
    expect([301, 302, 307, 308]).toContain(res.status)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('allows unauthenticated user to public pages', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const req = makeRequest({ pathname: '/login' })
    const handler = compose(withSession)
    const res = await handler(req)

    // Should not redirect (already on auth page, no sb- cookies → fast path)
    expect(res.status).not.toBe(307)
  })

  it('redirects authenticated user from /login to /dashboard', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })

    const req = makeRequest({
      pathname: '/login',
      cookies: { 'sb-access-token': 'token' },
    })
    const handler = compose(withSession)
    const res = await handler(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/dashboard')
  })

  it('sets x-user-id header for authenticated requests', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-456' } },
      error: null,
    })

    const req = makeRequest({
      pathname: '/dashboard',
      cookies: { 'sb-access-token': 'token' },
    })
    const handler = compose(withSession)
    const res = await handler(req)

    expect(res.headers.get('x-user-id')).toBe('user-456')
  })
})

describe('withUserStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows active user to access dashboard', async () => {
    mockFromSelectEqSingle.mockResolvedValue({ data: { status: 'active' } })

    const req = makeRequest({
      pathname: '/dashboard',
      cookies: { 'sb-access-token': 'token' },
      headers: { 'x-user-id': 'user-123' },
    })
    const handler = compose(withSession, withUserStatus)
    const res = await handler(req)

    // Should not redirect — active user is allowed
    expect(res.status).not.toBe(307)
  })

  it('blocks rejected user from dashboard', async () => {
    mockFromSelectEqSingle.mockResolvedValue({ data: { status: 'rejected' } })
    mockSignOut.mockResolvedValue({})

    const req = makeRequest({
      pathname: '/dashboard',
      cookies: { 'sb-access-token': 'token' },
      headers: { 'x-user-id': 'user-123' },
    })
    const handler = compose(withSession, withUserStatus)
    const res = await handler(req)

    expect([301, 302, 307, 308]).toContain(res.status)
    expect(res.headers.get('location')).toContain('account_blocked')
  })

  it('respects cached status (skips DB query)', async () => {
    const req = makeRequest({
      pathname: '/dashboard',
      cookies: {
        'sb-access-token': 'token',
        'cronix_user_status': 'active',
      },
      headers: { 'x-user-id': 'user-123' },
    })
    const handler = compose(withSession, withUserStatus)
    const res = await handler(req)

    // No DB query should be made
    expect(mockFromSelectEqSingle).not.toHaveBeenCalled()
    expect(res.status).not.toBe(307)
  })
})

describe('withSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-11T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows active session within limits', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })

    const req = makeRequest({
      pathname: '/dashboard',
      cookies: {
        'sb-access-token': 'token',
        'cronix_last_activity': String(Date.now() - 1000),
        'cronix_session_start': String(Date.now() - 60 * 60 * 1000),
      },
    })
    const handler = compose(withSession, withSessionTimeout)
    const res = await handler(req)

    expect(res.status).toBe(200)
  })

  it('redirects on 30-minute inactivity', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSignOut.mockResolvedValue({})

    const req = makeRequest({
      pathname: '/dashboard',
      cookies: {
        'sb-access-token': 'token',
        'cronix_last_activity': String(Date.now() - 31 * 60 * 1000),
        'cronix_session_start': String(Date.now() - 60 * 60 * 1000),
      },
    })

    const handler = compose(withSession, withSessionTimeout)
    const res = await handler(req)

    expect([301, 302, 307, 308]).toContain(res.status)
    expect(res.headers.get('location')).toContain('inactivity')
  })

  it('redirects on 12-hour absolute limit', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSignOut.mockResolvedValue({})

    const req = makeRequest({
      pathname: '/dashboard',
      cookies: {
        'sb-access-token': 'token',
        'cronix_last_activity': String(Date.now() - 1000),
        'cronix_session_start': String(Date.now() - 13 * 60 * 60 * 1000),
      },
    })

    const handler = compose(withSession, withSessionTimeout)
    const res = await handler(req)

    expect([301, 302, 307, 308]).toContain(res.status)
    expect(res.headers.get('location')).toContain('session_expired')
  })
})

describe('compose', () => {
  it('executes middleware in order', async () => {
    const order: string[] = []

    const mw1 = vi.fn(async (_req, _res, next) => {
      order.push('mw1')
      return next()
    })
    const mw2 = vi.fn(async (_req, _res, next) => {
      order.push('mw2')
      return next()
    })

    const handler = compose(mw1, mw2)
    await handler(makeRequest())

    expect(order).toEqual(['mw1', 'mw2'])
  })

  it('short-circuits when middleware returns a response', async () => {
    const order: string[] = []

    const mw1 = vi.fn(async (_req, _res, next) => {
      order.push('mw1')
      return NextResponse.redirect('https://example.com/login')
    })
    const mw2 = vi.fn(async (_req, _res, next) => {
      order.push('mw2')
      return next()
    })

    const handler = compose(mw1, mw2)
    await handler(makeRequest())

    expect(order).toEqual(['mw1']) // mw2 never runs
  })
})
