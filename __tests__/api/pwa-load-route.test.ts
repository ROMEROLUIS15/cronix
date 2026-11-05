import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PWA_LOAD_KEY, PWA_LOAD_MAX_ENTRIES } from '@/lib/pwa/load-metrics'

const mocks = vi.hoisted(() => ({
  redis: null as null | { lpush: ReturnType<typeof vi.fn>; ltrim: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> },
  allowed: true,
  user: null as null | { id: string },
  businessId: 'biz-1' as string | null,
}))

vi.mock('@/lib/rate-limit/redis-rate-limiter', () => ({
  getRedis: () => mocks.redis,
  redisRateLimit: vi.fn(async () => ({ allowed: mocks.allowed })),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { business_id: mocks.businessId } }) }) }) }),
  }),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

const { POST } = await import('@/app/api/pwa/load/route')

const REPORT = {
  id: 'abc123', phase: 'boot', path: '/dashboard', standalone: true, sw: 'controlled', online: true,
  elapsed: 4200, navType: 'navigate', response: 3900, dom: 0, load: 0, worker: 12, transfer: 0, fcp: 0, hiddenMs: 0,
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

const request = (body: string) => new NextRequest('https://cronix-app.vercel.app/api/pwa/load', {
  method: 'POST', body, headers: { 'user-agent': IPHONE, 'x-forwarded-for': '1.2.3.4', 'content-type': 'text/plain' },
})
const stored = () => (mocks.redis!.lpush.mock.calls as Array<[string, string]>).map(([, v]) => JSON.parse(v))

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  mocks.redis = { lpush: vi.fn(async () => 1), ltrim: vi.fn(async () => 'OK'), expire: vi.fn(async () => 1) }
  mocks.allowed = true
  mocks.user = { id: 'user-1' }
  mocks.businessId = 'biz-1'
})
afterEach(() => { vi.unstubAllEnvs() })

describe('POST /api/pwa/load', () => {
  it('stores a report with the business of the session and the device', async () => {
    const res = await POST(request(JSON.stringify(REPORT)))
    expect(res.status).toBe(204)
    expect(mocks.redis!.lpush).toHaveBeenCalledWith(PWA_LOAD_KEY, expect.any(String))
    expect(stored()[0]).toMatchObject({ ...REPORT, businessId: 'biz-1', ua: IPHONE })
    expect(mocks.redis!.ltrim).toHaveBeenCalledWith(PWA_LOAD_KEY, 0, PWA_LOAD_MAX_ENTRIES - 1)
    expect(mocks.redis!.expire).toHaveBeenCalledWith(PWA_LOAD_KEY, 30 * 24 * 60 * 60)
  })

  it('stores an open without session, such as one that lands on the login page', async () => {
    mocks.user = null
    await POST(request(JSON.stringify({ ...REPORT, path: '/login' })))
    expect(stored()[0]).toMatchObject({ path: '/login', businessId: null })
  })

  it.each([
    ['not JSON', 'hola'],
    ['an unknown phase', JSON.stringify({ ...REPORT, phase: 'crash' })],
    ['an extra field', JSON.stringify({ ...REPORT, businessId: 'someone-else' })],
    ['a body over 2 KB', JSON.stringify({ ...REPORT, path: 'x'.repeat(2100) })],
  ])('drops %s and still answers 204', async (_label, body) => {
    const res = await POST(request(body))
    expect(res.status).toBe(204)
    expect(mocks.redis!.lpush).not.toHaveBeenCalled()
  })

  it('drops reports over the per-address limit', async () => {
    mocks.allowed = false
    expect((await POST(request(JSON.stringify(REPORT)))).status).toBe(204)
    expect(mocks.redis!.lpush).not.toHaveBeenCalled()
  })

  it('stores nothing outside production', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await POST(request(JSON.stringify(REPORT)))).status).toBe(204)
    expect(mocks.redis!.lpush).not.toHaveBeenCalled()
  })

  it('answers 204 when Redis is not configured or fails', async () => {
    mocks.redis = null
    expect((await POST(request(JSON.stringify(REPORT)))).status).toBe(204)
    mocks.redis = { lpush: vi.fn(async () => { throw new Error('down') }), ltrim: vi.fn(), expire: vi.fn() }
    expect((await POST(request(JSON.stringify(REPORT)))).status).toBe(204)
  })
})
