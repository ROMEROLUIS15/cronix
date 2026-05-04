/**
 * DeleteClientUseCase
 *
 * Guards: verifies the client has no upcoming appointments before soft-deleting.
 * Uses findUpcomingByClient to check future slots — never deletes blindly.
 */

import type { IClientRepository } from '@/lib/domain/repositories/IClientRepository'
import type { IAppointmentQueryRepository } from '@/lib/domain/repositories/IAppointmentQueryRepository'
import { ok, fail, type Result } from '@/types/result'

export interface DeleteClientInput {
  businessId: string
  clientId:   string
}

export class DeleteClientUseCase {
  constructor(
    private clientRepo:       IClientRepository,
    private appointmentQuery: IAppointmentQueryRepository,
  ) {}

  async execute(input: DeleteClientInput): Promise<Result<void>> {
    const upcoming = await this.appointmentQuery.findUpcomingByClient(
      input.businessId,
      input.clientId,
    )
    if (upcoming.error) {
      return fail('No se pudo verificar las citas del cliente.')
    }
    if (upcoming.data && upcoming.data.length > 0) {
      return fail(
        `No se puede eliminar: el cliente tiene ${upcoming.data.length} cita(s) futura(s). Cancélalas primero.`,
      )
    }

    return this.clientRepo.softDelete(input.clientId, input.businessId)
  }
}
