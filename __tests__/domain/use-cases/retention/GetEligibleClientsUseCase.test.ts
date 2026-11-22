/**
 * GetEligibleClientsUseCase.test.ts
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4.
 * Covers: the owner's days drive both selection and the wait before writing again,
 * row→EligibleClient mapping, and error paths.
 */

import { describe, it, expect, vi } from 'vitest'
import { ok, fail } from '@/types/result'
import type { IClientRepository } from '@/lib/domain/repositories'
import type { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import { GetEligibleClientsUseCase } from '@/lib/domain/use-cases/retention/GetEligibleClientsUseCase'

const BIZ = 'biz-1'

function businessRepoWith(frequency: number): IBusinessRepository {
  return {
    getById: vi.fn(async () =>
      ok({ id: BIZ, name: 'Bella Salón', plan: 'pro', default_attendance_frequency_days: frequency } as never),
    ),
  } as unknown as IBusinessRepository
}

it.each([15, 20, 25, 45])(
  'uses the owner\'s %i days both to pick the clients and to wait before writing again',
  async (days) => {
    const findInactiveByFrequency = vi.fn(async () => ok([]))
    const clientRepo = { findInactiveByFrequency } as unknown as IClientRepository
    const useCase = new GetEligibleClientsUseCase(clientRepo, businessRepoWith(days))

    await useCase.execute({ businessId: BIZ })

    // No fixed value: a client who still has not come back is written to again
    // after the same number of days the owner chose.
    expect(findInactiveByFrequency).toHaveBeenCalledWith(BIZ, days, days)
  },
)

it('maps repo rows to EligibleClient (drops lastVisitAt)', async () => {
  const clientRepo = {
    findInactiveByFrequency: vi.fn(async () =>
      ok([
        {
          id: 'cli-1',
          name: 'Juan',
          phone: '+573210000001',
          lastVisitAt: '2026-03-01T10:00:00Z',
          lastCompletedAt: '2026-03-01T10:00:00Z',
        },
      ]),
    ),
  } as unknown as IClientRepository
  const useCase = new GetEligibleClientsUseCase(clientRepo, businessRepoWith(30))

  const result = await useCase.execute({ businessId: BIZ })

  expect(result.error).toBeNull()
  expect(result.data).toEqual([
    { id: 'cli-1', name: 'Juan', phone: '+573210000001', lastCompletedAt: '2026-03-01T10:00:00Z' },
  ])
})

it('fails when the business cannot be loaded', async () => {
  const businessRepo = {
    getById: vi.fn(async () => fail('not found')),
  } as unknown as IBusinessRepository
  const clientRepo = { findInactiveByFrequency: vi.fn() } as unknown as IClientRepository
  const useCase = new GetEligibleClientsUseCase(clientRepo, businessRepo)

  const result = await useCase.execute({ businessId: BIZ })

  expect(result.data).toBeNull()
  expect(result.error).toBeTruthy()
})

it('fails when the candidates query errors', async () => {
  const clientRepo = {
    findInactiveByFrequency: vi.fn(async () => fail('rpc boom')),
  } as unknown as IClientRepository
  const useCase = new GetEligibleClientsUseCase(clientRepo, businessRepoWith(30))

  const result = await useCase.execute({ businessId: BIZ })

  expect(result.data).toBeNull()
  expect(result.error).toBeTruthy()
})
