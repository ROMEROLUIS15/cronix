/**
 * CreateAppointmentUseCase.ts
 *
 * Orchestrates: conflict check → create appointment → return result.
 * Depends ONLY on repository interfaces (no Supabase, no channels, no AI).
 */

import type {
  IAppointmentQueryRepository,
  IAppointmentCommandRepository,
} from '@/lib/domain/repositories'
import type { CreateAppointmentInput, CreateAppointmentOutput } from './types'
import { ok, fail, type Result } from '@/types/result'

export class CreateAppointmentUseCase {
  constructor(
    private queryRepo: IAppointmentQueryRepository,
    private commandRepo: IAppointmentCommandRepository,
  ) {}

  async execute(input: CreateAppointmentInput): Promise<Result<CreateAppointmentOutput>> {
    // 1. Check for slot conflicts
    const conflicts = await this.queryRepo.findConflicts(
      input.businessId,
      input.startAt,
      input.endAt,
    )
    if (conflicts.error || !conflicts.data) {
      return fail('No se pudo verificar la disponibilidad del horario.')
    }
    if (conflicts.data.length > 0) {
      return fail('Ese horario ya está ocupado. Sugiere otro horario al cliente.')
    }

    // 2. Create the appointment
    const result = await this.commandRepo.create({
      business_id: input.businessId,
      client_id: input.clientId,
      service_ids: input.serviceIds,
      assigned_user_id: input.assignedUserId ?? null,
      start_at: input.startAt,
      end_at: input.endAt,
      notes: input.notes ?? null,
      status: 'pending',
      is_dual_booking: false,
    })

    if (result.error || !result.data) {
      return fail(`Error al crear la cita: ${result.error ?? 'respuesta vacía'}`)
    }

    return ok({
      id: result.data.id,
      businessId: result.data.business_id,
      clientId: result.data.client_id,
      status: result.data.status,
    })
  }
}
