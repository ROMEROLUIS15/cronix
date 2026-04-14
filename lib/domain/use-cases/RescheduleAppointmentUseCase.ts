/**
 * RescheduleAppointmentUseCase.ts
 */

import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'
import type { RescheduleAppointmentInput } from './types'
import { ok, fail, type Result } from '@/types/result'

export class RescheduleAppointmentUseCase {
  constructor(
    private queryRepo: IAppointmentQueryRepository,
    private commandRepo: IAppointmentCommandRepository,
  ) {}

  async execute(input: RescheduleAppointmentInput): Promise<Result<void>> {
    // 1. Check for conflicts at the new time
    const conflicts = await this.queryRepo.findConflicts(
      input.businessId,
      input.newStartAt,
      input.newEndAt,
      input.appointmentId, // exclude the appointment being rescheduled
    )
    if (conflicts.error) {
      return fail('No se pudo verificar la disponibilidad del nuevo horario.')
    }
    if (conflicts.data.length > 0) {
      return fail('El nuevo horario ya está ocupado. Sugiere otro horario.')
    }

    // 2. Reschedule
    const result = await this.commandRepo.reschedule(
      input.appointmentId,
      input.newStartAt,
      input.newEndAt,
      input.businessId,
    )

    if (result.error) {
      return fail(`No se pudo reagendar la cita: ${result.error}`)
    }

    return ok(undefined)
  }
}
