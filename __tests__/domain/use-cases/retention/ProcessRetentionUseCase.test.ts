/**
 * ProcessRetentionUseCase.test.ts
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §9 acceptance criteria.
 * Covers: AC-5 (toggle OFF), AC-6 (daily cap), AC-7 (anti-spam stamp on send),
 * AC-11 (plan gating), plus messenger failure accounting and tenant scoping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ok } from '@/types/result'
import type { IClientRepository } from '@/lib/domain/repositories'
import type { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import { GetEligibleClientsUseCase } from '@/lib/domain/use-cases/retention/GetEligibleClientsUseCase'
import { ProcessRetentionUseCase } from '@/lib/domain/use-cases/retention/ProcessRetentionUseCase'
import type {
  IRetentionMessenger,
  EligibleClient,
  SendWinbackResult,
} from '@/lib/domain/use-cases/retention/types'

const BIZ = 'biz-1'

const SENT: SendWinbackResult = { ok: true }

function rejected(scope: 'platform' | 'recipient', code: number | null): SendWinbackResult {
  return {
    ok: false,
    failure: { scope, code, template: 'client_winback', message: `meta rejected (${code})` },
  }
}

type AnyMock = ReturnType<typeof vi.fn>

type BusinessOverrides = {
  plan?: string | null
  enabled?: boolean
  dailyCap?: number
  frequency?: number
}

function makeBusinessRow(o: BusinessOverrides) {
  return {
    id: BIZ,
    name: 'Bella Salón',
    plan: o.plan === undefined ? 'pro' : o.plan,
    default_attendance_frequency_days: o.frequency ?? 30,
    settings: {
      retention: {
        enabled: o.enabled ?? true,
        ...(o.dailyCap !== undefined ? { dailyCap: o.dailyCap } : {}),
      },
    },
  }
}

function makeBusinessRepo(o: BusinessOverrides): IBusinessRepository {
  return {
    getById: vi.fn(async () => ok(makeBusinessRow(o) as never)),
  } as unknown as IBusinessRepository
}

function makeClientRepo(
  eligible: EligibleClient[],
  updateSpy: AnyMock = vi.fn(async () => ok(undefined)),
): IClientRepository {
  return {
    findInactiveByFrequency: vi.fn(async () =>
      ok(
        eligible.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          lastVisitAt: null,
          lastCompletedAt: c.lastCompletedAt,
        })),
      ),
    ),
    updateLastReengaged: updateSpy,
  } as unknown as IClientRepository
}

function makeMessenger(send: AnyMock = vi.fn(async () => SENT)): IRetentionMessenger {
  return { sendWinback: send } as unknown as IRetentionMessenger
}

function clients(n: number): EligibleClient[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cli-${i}`,
    name: `Cliente ${i}`,
    phone: `+57300000${String(i).padStart(4, '0')}`,
    lastCompletedAt: '2026-04-01T10:00:00Z',
  }))
}

function build(o: BusinessOverrides, eligible: EligibleClient[], deps?: {
  send?: AnyMock
  update?: AnyMock
}) {
  const businessRepo = makeBusinessRepo(o)
  const clientRepo = makeClientRepo(eligible, deps?.update)
  const getEligible = new GetEligibleClientsUseCase(clientRepo, businessRepo)
  const messenger = makeMessenger(deps?.send)
  const useCase = new ProcessRetentionUseCase(businessRepo, clientRepo, getEligible, messenger)
  return { useCase, businessRepo, clientRepo, messenger }
}

beforeEach(() => vi.clearAllMocks())

describe('ProcessRetentionUseCase', () => {
  it('AC-11: free plan is a no-op (zero sends)', async () => {
    const send = vi.fn(async () => SENT)
    const { useCase } = build({ plan: 'free' }, clients(5), { send })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.error).toBeNull()
    expect(result.data).toEqual({ sent: 0, failed: 0, capped: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('AC-11: null plan is treated as non-Pro+ (no-op)', async () => {
    const send = vi.fn(async () => SENT)
    const { useCase } = build({ plan: null }, clients(3), { send })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 0, failed: 0, capped: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('AC-5: toggle OFF is a no-op even on Pro+', async () => {
    const send = vi.fn(async () => SENT)
    const { useCase } = build({ plan: 'pro', enabled: false }, clients(5), { send })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 0, failed: 0, capped: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends the win-back template to every candidate and stamps anti-spam', async () => {
    const send = vi.fn(async () => SENT)
    const update = vi.fn(async () => ok(undefined))
    const { useCase } = build({ enabled: true }, clients(3), { send, update })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 3, failed: 0, capped: false })
    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenCalledWith({
      to: '+573000000000',
      clientName: 'Cliente 0',
      businessName: 'Bella Salón',
    })
    // AC-7: one anti-spam stamp per successful send, scoped to the business.
    expect(update).toHaveBeenCalledTimes(3)
    expect(update).toHaveBeenCalledWith('cli-0', BIZ)
  })

  it('AC-6: caps the batch at dailyCap and reports capped=true', async () => {
    const send = vi.fn(async () => SENT)
    const update = vi.fn(async () => ok(undefined))
    const { useCase } = build({ enabled: true, dailyCap: 2 }, clients(5), { send, update })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 2, failed: 0, capped: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('does not stamp anti-spam when a recipient-level send fails, and keeps going', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(rejected('recipient', 131049))
      .mockResolvedValueOnce(SENT)
    const update = vi.fn(async () => ok(undefined))
    const { useCase } = build({ enabled: true }, clients(3), { send, update })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 2, failed: 1, capped: false })
    expect(send).toHaveBeenCalledTimes(3)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('aborts the run on the first platform-wide failure: no more sends, no stamp, reason reported', async () => {
    const send = vi.fn(async () => rejected('platform', 132001))
    const update = vi.fn(async () => ok(undefined))
    const { useCase } = build({ enabled: true }, clients(50), { send, update })

    const result = await useCase.execute({ businessId: BIZ })

    expect(send).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(result.data).toEqual({
      sent: 0,
      failed: 1,
      capped: false,
      aborted: {
        scope: 'platform',
        code: 132001,
        template: 'client_winback',
        message: 'meta rejected (132001)',
      },
    })
  })

  it('keeps the sends that already succeeded when a platform failure interrupts the run', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(rejected('platform', 132015))
    const update = vi.fn(async () => ok(undefined))
    const { useCase } = build({ enabled: true }, clients(10), { send, update })

    const result = await useCase.execute({ businessId: BIZ })

    expect(send).toHaveBeenCalledTimes(3)
    expect(update).toHaveBeenCalledTimes(2)
    expect(result.data).toMatchObject({ sent: 2, failed: 1, aborted: { code: 132015 } })
  })

  it('a completed run carries no aborted field', async () => {
    const { useCase } = build({ enabled: true }, clients(2))

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).not.toHaveProperty('aborted')
  })

  it('exactly dailyCap candidates is not flagged as capped', async () => {
    const { useCase } = build({ enabled: true, dailyCap: 3 }, clients(3))

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 3, failed: 0, capped: false })
  })

  it('uses the default dailyCap (50) when unset', async () => {
    const send = vi.fn(async () => SENT)
    const { useCase } = build({ enabled: true }, clients(60), { send })

    const result = await useCase.execute({ businessId: BIZ })

    expect(result.data).toEqual({ sent: 50, failed: 0, capped: true })
    expect(send).toHaveBeenCalledTimes(50)
  })
})
