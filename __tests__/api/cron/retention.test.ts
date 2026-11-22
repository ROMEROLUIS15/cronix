/**
 * retention.test.ts — POST/GET /api/cron/retention.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §6 (cron) and §7 (send failures).
 * The use case itself is covered in ProcessRetentionUseCase.test.ts; here only the
 * route contract: auth, fan-out, and what happens when a run aborts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabledIds: ['biz-1', 'biz-2', 'biz-3'] as string[],
  execute: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/repositories', () => ({
  getRepos: () => ({
    businesses: { findRetentionEnabledIds: async () => ({ data: mocks.enabledIds, error: null }) },
    clients: {},
  }),
}))
vi.mock('@/lib/services/winback-messenger', () => ({ WinbackMessenger: class {} }))
vi.mock('@/lib/domain/use-cases/retention', () => ({
  GetEligibleClientsUseCase: class {},
  ProcessRetentionUseCase: class {
    execute = (input: { businessId: string }) => mocks.execute(input)
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }))

const { POST } = await import('@/app/api/cron/retention/route')

const call = (secret: string | null = 'cron-secret') =>
  POST(new Request('https://cronix-app.vercel.app/api/cron/retention', {
    method: 'POST',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }))

const completed = (sent: number) => ({ data: { sent, failed: 0, capped: false }, error: null })
const aborted = (code: number) => ({
  data: {
    sent: 0,
    failed: 1,
    capped: false,
    aborted: { scope: 'platform', code, template: 'client_winback', message: `meta rejected (${code})` },
  },
  error: null,
})

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  mocks.enabledIds = ['biz-1', 'biz-2', 'biz-3']
  mocks.execute.mockReset()
  mocks.loggerError.mockReset()
})
afterEach(() => { vi.unstubAllEnvs() })

describe('/api/cron/retention', () => {
  it('rejects a request without the cron secret and runs nothing', async () => {
    const res = await call(null)

    expect(res.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('runs every enabled business and sums the totals', async () => {
    mocks.execute.mockResolvedValueOnce(completed(3)).mockResolvedValueOnce(completed(2)).mockResolvedValueOnce(completed(1))

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, businesses: 3, sent: 6, failed: 0, capped: 0 })
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })

  it('stops the fan-out on a platform-wide abort, reports it once, and answers 502', async () => {
    mocks.execute.mockResolvedValueOnce(completed(2)).mockResolvedValueOnce(aborted(132001))

    const res = await call()

    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      ok: false,
      businesses: 2,
      sent: 2,
      failed: 1,
      capped: 0,
      aborted: { businessId: 'biz-2', code: 132001, template: 'client_winback' },
    })
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'retention',
      'Win-back run aborted by a platform-wide WhatsApp failure',
      expect.objectContaining({ businessId: 'biz-2', code: 132001, template: 'client_winback' }),
    )
  })

  it('keeps the Sentry message stable and leaves client data out of the report', async () => {
    mocks.execute.mockResolvedValueOnce(aborted(132015))

    await call()

    const [, message, detail] = mocks.loggerError.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(message).not.toMatch(/132015|biz-1/)
    expect(Object.keys(detail).sort()).toEqual(['businessId', 'code', 'message', 'template'])
  })
})
