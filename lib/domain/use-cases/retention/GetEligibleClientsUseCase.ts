/**
 * GetEligibleClientsUseCase.ts
 *
 * Reads the business visit frequency and returns the deterministic list of
 * clients eligible for re-engagement (past completed visit beyond frequency, no
 * active future appointment, outside the anti-spam window, with a phone).
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4.
 */

import type { IClientRepository } from '@/lib/domain/repositories'
import type { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import { ok, fail, type Result } from '@/types/result'
import { RETENTION_DEFAULTS, type EligibleClient, type GetEligibleClientsInput } from './types'

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

    const candidates = await this.clientRepo.findInactiveByFrequency(
      input.businessId,
      frequencyDays,
      RETENTION_DEFAULTS.antiSpamDays,
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
