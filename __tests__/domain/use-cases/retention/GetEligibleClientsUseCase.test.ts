/**
 * GetEligibleClientsUseCase.test.ts
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4.
 * Covers: frequency read from the business, anti-spam default passthrough,
 * row→EligibleClient mapping, and error paths.
 */

import { describe, it, expect, vi } from 'vitest'
import { ok, fail } from '@/types/result'
import type { IClientRepository } from '@/lib/domain/repositories'
import type { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import { GetEligibleClientsUseCase } from '@/lib/domain/use-cases/retention/GetEligibleClientsUseCase'
import { RETENTION_DEFAULTS } from '@/lib/domain/use-cases/retention/types'

const BIZ = 'biz-1'

function businessRepoWith(frequency: number): IBusinessRepository {
  return {
    getById: vi.fn(async () =>
      ok({ id: BIZ, name: 'Bella Salón', plan: 'pro', default_attendance_frequency_days: frequency } as never),
    ),
  } as unknown as IBusinessRepository
}

it('passes the business frequency + default anti-spam to the repo', async () => {
  const findInactiveByFrequency = vi.fn(async () => ok([]))
  const clientRepo = { findInactiveByFrequency } as unknown as IClientRepository
  const useCase = new GetEligibleClientsUseCase(clientRepo, businessRepoWith(45))

  await useCase.execute({ businessId: BIZ })

  expect(findInactiveByFrequency).toHaveBeenCalledWith(BIZ, 45, RETENTION_DEFAULTS.antiSpamDays)
})

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
