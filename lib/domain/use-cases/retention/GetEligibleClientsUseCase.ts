/**
 * GetEligibleClientsUseCase.ts
 *
 * Reads the number of days the owner chose and returns the deterministic list of
 * clients eligible for re-engagement: last visit (any past appointment not
 * cancelled and not a no-show) more than that many days ago, no active future
 * appointment, not written to in that many days, with a phone.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4.
 */

import type { IClientRepository } from '@/lib/domain/repositories'
import type { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import { ok, fail, type Result } from '@/types/result'
import type { EligibleClient, GetEligibleClientsInput } from './types'

export class GetEligibleClientsUseCase {
  constructor(
    private clientRepo: IClientRepository,
    private businessRepo: IBusinessRepository,
  ) {}

  async execute(input: GetEligibleClientsInput): Promise<Result<EligibleClient[]>> {
    const business = await this.businessRepo.getById(input.businessId)
    if (business.error || !business.data) {
      return fail('No se pudo cargar el negocio para la retención.')
    }

    const frequencyDays = business.data.default_attendance_frequency_days

    // The owner's number drives both: who has gone that long without a visit, and
    // how long to wait before writing again to a client who still has not come back.
    const candidates = await this.clientRepo.findInactiveByFrequency(
      input.businessId,
      frequencyDays,
      frequencyDays,
    )
    if (candidates.error) {
      return fail('No se pudieron consultar los clientes elegibles.')
    }

    const eligible: EligibleClient[] = (candidates.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      lastCompletedAt: c.lastCompletedAt,
    }))

    return ok(eligible)
  }
}
