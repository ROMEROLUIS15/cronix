/**
 * CancelAppointmentUseCase.ts
 */

import type { IAppointmentCommandRepository } from '@/lib/domain/repositories'
import type { CancelAppointmentInput } from './types'
import { ok, fail, type Result } from '@/types/result'

export class CancelAppointmentUseCase {
  constructor(
    private commandRepo: IAppointmentCommandRepository,
  ) {}

  async execute(input: CancelAppointmentInput): Promise<Result<void>> {
    const result = await this.commandRepo.updateStatus(
      input.appointmentId,
      'cancelled',
      input.businessId,
    )

    if (result.error) {
      return fail(`No se pudo cancelar la cita: ${result.error}`)
    }

    return ok(undefined)
  }
}
