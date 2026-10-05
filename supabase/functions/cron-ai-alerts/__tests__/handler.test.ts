import { describe, it, expect, vi } from 'vitest'
import { handleCronAiAlerts, type HandlerDeps, type ClaimedAlert } from '../handler.ts'

const SECRET = 'test-secret'
const BIZ_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const BIZ_B = 'bbbbbbbb-0000-0000-0000-000000000002'

function makeDeps(overrides: Partial<HandlerDeps> = {}) {
  const deps = {
    cronSecret:  SECRET as string | undefined,
    claimAlerts: vi.fn(async () => ({ data: [] as ClaimedAlert[], error: null })),
    report:      vi.fn(),
    reportError: vi.fn(),
    flush:       vi.fn(async () => {}),
    ...overrides,
  }
  return deps satisfies HandlerDeps
}

const post = (headers: Record<string, string> = {}) =>
  new Request('https://example.test/cron-ai-alerts', { method: 'POST', headers })

describe('cron-ai-alerts handler', () => {
  describe('AC-4 — auth', () => {
    it('rejects a request without Authorization and does not claim', async () => {
      const deps = makeDeps()
      const res = await handleCronAiAlerts(post(), deps)
      expect(res.status).toBe(401)
      expect(deps.claimAlerts).not.toHaveBeenCalled()
    })

    it('rejects a wrong secret and does not claim', async () => {
      const deps = makeDeps()
      const res = await handleCronAiAlerts(post({ authorization: 'Bearer nope' }), deps)
      expect(res.status).toBe(401)
      expect(deps.claimAlerts).not.toHaveBeenCalled()
    })

    it('rejects everything when the CRON_SECRET env is missing', async () => {
      const deps = makeDeps({ cronSecret: undefined })
      const res = await handleCronAiAlerts(post({ authorization: 'Bearer undefined' }), deps)
      expect(res.status).toBe(401)
      expect(deps.claimAlerts).not.toHaveBeenCalled()
    })
  })

  it('zero claimed alerts → 200, nothing reported', async () => {
    const deps = makeDeps()
    const res = await handleCronAiAlerts(post({ authorization: `Bearer ${SECRET}` }), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ alerts: 0 })
    expect(deps.report).not.toHaveBeenCalled()
  })

  it('reports one error-level message per claimed alert with a per-business fingerprint', async () => {
    const claimed: ClaimedAlert[] = [
      { business_id: BIZ_A, failure_count: 4, breakdown: { DB_ERROR: 3, LLM_EXCEPTION: 1 } },
      { business_id: BIZ_B, failure_count: 3, breakdown: { 'outcome:error': 3 } },
    ]
    const deps = makeDeps({ claimAlerts: vi.fn(async () => ({ data: claimed, error: null })) })

    const res = await handleCronAiAlerts(post({ authorization: `Bearer ${SECRET}` }), deps)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ alerts: 2 })
    expect(deps.report).toHaveBeenCalledTimes(2)
    expect(deps.report).toHaveBeenNthCalledWith(1, {
      message: 'ai_agent_failure_threshold',
      level:   'error',
      extra: {
        business_id: BIZ_A, failure_count: 4,
        breakdown: { DB_ERROR: 3, LLM_EXCEPTION: 1 }, window_min: 10,
      },
      fingerprint: ['ai_agent_failure_threshold', BIZ_A],
    })
    expect(deps.report.mock.calls[1]?.[0].fingerprint).toEqual(['ai_agent_failure_threshold', BIZ_B])
    expect(deps.flush).toHaveBeenCalledTimes(1)
  })

  it('RPC error → captures the exception, flushes and answers 500', async () => {
    const deps = makeDeps({
      claimAlerts: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
    })
    const res = await handleCronAiAlerts(post({ authorization: `Bearer ${SECRET}` }), deps)

    expect(res.status).toBe(500)
    expect(deps.reportError).toHaveBeenCalledTimes(1)
    expect(deps.flush).toHaveBeenCalledTimes(1)
    expect(deps.report).not.toHaveBeenCalled()
  })
})
