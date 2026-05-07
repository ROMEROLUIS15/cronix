/**
 * GetAppointmentsByDateUseCase.ts
 */

import type { IAppointmentQueryRepository } from '@/lib/domain/repositories'
import type { GetAppointmentsByDateInput, AppointmentSummary } from './types'
import { ok, fail, type Result } from '@/types/result'
export class GetAppointmentsByDateUseCase {
  constructor(
    private queryRepo: IAppointmentQueryRepository,
  ) {}

  async execute(input: GetAppointmentsByDateInput): Promise<Result<AppointmentSummary[]>> {
    const result = await this.queryRepo.getDayAppointments(input.businessId, input.date)

    if (result.error) {
      return fail('Error al consultar las citas del día.')
    }

    const active = (result.data ?? []).filter(
      (a) => a.status !== 'cancelled' && a.status !== 'no_show'
    )

    const timezone = input.timezone ?? 'UTC'

    const summaries: AppointmentSummary[] = active
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .map((a) => {
        const clientName = (a.client as { name: string } | null)?.name ?? 'Cliente'
        const serviceName =
          (a.service as { name: string } | null)?.name ??
          (a.appointment_services as { service: { name: string } }[] | null)?.[0]?.service?.name ??
          'Servicio'

        // Format in the user's local timezone, not the server's UTC timezone.
        // Intl.DateTimeFormat resolves the correct offset for the given IANA timezone.
        const timeStr = new Intl.DateTimeFormat('es-419', {
          hour:     'numeric',
          minute:   '2-digit',
          hour12:   true,
          timeZone: timezone,
        }).format(new Date(a.start_at))

        return {
          id: a.id,
          time: timeStr,
          clientName,
          serviceName,
          status: a.status ?? 'pending',
        }
      })

    return ok(summaries)
  }
}
