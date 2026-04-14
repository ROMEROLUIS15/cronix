/**
 * RealToolExecutor.ts — Production IToolExecutor implementation.
 *
 * Replaces MockToolExecutor. Maps tool names to real UseCases backed by
 * Supabase repositories. Zero mocks, zero hardcoded strings.
 *
 * Client resolution: findActiveForAI() + fuzzyFind() (same pattern as
 * the existing appointment.tools.ts — no new DB methods required).
 *
 * Service resolution: getActive() + Array.find() by serviceId.
 *
 * Date building: `${date}T${time}:00` consistent with existing tools.
 */

import { z } from 'zod'
import type { IToolExecutor, ToolExecuteParams } from '../execution-engine'
import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'
import type { IClientRepository } from '@/lib/domain/repositories/IClientRepository'
import type { IServiceRepository } from '@/lib/domain/repositories/IServiceRepository'
import { CreateAppointmentUseCase }     from '@/lib/domain/use-cases/CreateAppointmentUseCase'
import { CancelAppointmentUseCase }     from '@/lib/domain/use-cases/CancelAppointmentUseCase'
import { RescheduleAppointmentUseCase } from '@/lib/domain/use-cases/RescheduleAppointmentUseCase'
import { GetAppointmentsByDateUseCase } from '@/lib/domain/use-cases/GetAppointmentsByDateUseCase'
import { fuzzyFind }                    from '@/lib/ai/fuzzy-match'
import { logger }                       from '@/lib/logger'

// ── Schemas ────────────────────────────────────────────────────────────────────

const ConfirmBookingSchema = z.object({
  serviceId:  z.string().uuid(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time:       z.string().regex(/^\d{2}:\d{2}$/),
  clientName: z.string().optional(),
  clientId:   z.string().uuid().optional(),
  staffId:    z.string().uuid().optional(),
})

const CancelBookingSchema = z.object({
  appointmentId: z.string().uuid(),
})

const RescheduleBookingSchema = z.object({
  appointmentId: z.string().uuid(),
  newDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newTime:       z.string().regex(/^\d{2}:\d{2}$/),
})

const GetByDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// ── Types ──────────────────────────────────────────────────────────────────────

type ExecResult = { success: boolean; result: string; error?: string }

// ── Implementation ─────────────────────────────────────────────────────────────

export class RealToolExecutor implements IToolExecutor {
  constructor(
    private queryRepo:   IAppointmentQueryRepository,
    private commandRepo: IAppointmentCommandRepository,
    private clientRepo:  IClientRepository,
    private serviceRepo: IServiceRepository,
  ) {}

  async execute(p: ToolExecuteParams): Promise<ExecResult> {
    try {
      switch (p.toolName) {
        case 'confirm_booking':          return this.confirmBooking(p)
        case 'cancel_booking':           return this.cancelBooking(p)
        case 'reschedule_booking':       return this.rescheduleBooking(p)
        case 'get_appointments_by_date': return this.getByDate(p)
        case 'get_services':             return this.getServices(p)
        default:
          return { success: false, result: `Tool "${p.toolName}" no implementada.`, error: 'TOOL_NOT_FOUND' }
      }
    } catch (err) {
      logger.error('REAL-TOOL-EXECUTOR', `Unhandled error in ${p.toolName}`, { err })
      return { success: false, result: 'Error interno al ejecutar la acción.' }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async resolveClient(
    businessId: string,
    clientName?: string,
    clientId?: string,
  ): Promise<{ id: string; name: string } | null> {
    if (clientId) {
      const res = await this.clientRepo.getById(clientId, businessId)
      if (res.error || !res.data) return null
      return { id: res.data.id, name: res.data.name }
    }

    if (!clientName) return null

    const allRes = await this.clientRepo.findActiveForAI(businessId)
    if (allRes.error || !allRes.data?.length) return null

    const found = fuzzyFind(allRes.data, clientName)
    if (found.status !== 'found') return null
    return { id: found.match.id, name: found.match.name }
  }

  private async resolveService(
    businessId: string,
    serviceId: string,
  ): Promise<{ duration_min: number; name: string } | null> {
    const res = await this.serviceRepo.getActive(businessId)
    if (res.error || !res.data) return null
    const svc = res.data.find((s) => s.id === serviceId)
    return svc ? { duration_min: svc.duration_min, name: svc.name } : null
  }

  private buildEndISO(startISO: string, durationMin: number): string {
    return new Date(new Date(startISO).getTime() + durationMin * 60_000).toISOString()
  }

  // ── Tools ────────────────────────────────────────────────────────────────────

  private async confirmBooking(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = ConfirmBookingSchema.safeParse(p.args)
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
      return { success: false, result: `Faltan datos para agendar: ${fields}` }
    }

    const { serviceId, date, time, clientName, clientId: clientIdArg, staffId } = parsed.data

    const client = await this.resolveClient(p.businessId, clientName, clientIdArg)
    if (!client) {
      const label = clientName ?? clientIdArg ?? 'el cliente'
      return { success: false, result: `No encontré al cliente "${label}". ¿Está registrado?` }
    }

    const service = await this.resolveService(p.businessId, serviceId)
    if (!service) {
      return { success: false, result: 'No encontré el servicio seleccionado.' }
    }

    const startISO = `${date}T${time}:00`
    const endISO   = this.buildEndISO(startISO, service.duration_min)

    const result = await new CreateAppointmentUseCase(this.queryRepo, this.commandRepo).execute({
      businessId:     p.businessId,
      clientId:       client.id,
      serviceIds:     [serviceId],
      startAt:        startISO,
      endAt:          endISO,
      assignedUserId: staffId ?? null,
    })

    if (result.error) return { success: false, result: result.error }

    return {
      success: true,
      result: `Listo. Agendé a ${client.name} para ${service.name} el ${date} a las ${time}.`,
    }
  }

  private async cancelBooking(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = CancelBookingSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito el ID de la cita para cancelarla.' }
    }

    const result = await new CancelAppointmentUseCase(this.commandRepo).execute({
      businessId:    p.businessId,
      appointmentId: parsed.data.appointmentId,
    })

    if (result.error) return { success: false, result: result.error }
    return { success: true, result: 'Listo. La cita ha sido cancelada.' }
  }

  private async rescheduleBooking(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = RescheduleBookingSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito la cita, la nueva fecha y hora para reagendar.' }
    }

    const appt = await this.queryRepo.getForEdit(parsed.data.appointmentId, p.businessId)
    if (appt.error || !appt.data) {
      return { success: false, result: 'No encontré la cita.' }
    }

    let durationMin = 60
    if (appt.data.service_id) {
      const svc = await this.resolveService(p.businessId, appt.data.service_id)
      if (svc) durationMin = svc.duration_min
    }

    const newStartISO = `${parsed.data.newDate}T${parsed.data.newTime}:00`
    const newEndISO   = this.buildEndISO(newStartISO, durationMin)

    const result = await new RescheduleAppointmentUseCase(this.queryRepo, this.commandRepo).execute({
      businessId:    p.businessId,
      appointmentId: parsed.data.appointmentId,
      newStartAt:    newStartISO,
      newEndAt:      newEndISO,
    })

    if (result.error) return { success: false, result: result.error }

    return {
      success: true,
      result: `Listo. La cita fue reagendada para el ${parsed.data.newDate} a las ${parsed.data.newTime}.`,
    }
  }

  private async getByDate(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = GetByDateSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
    }

    const result = await new GetAppointmentsByDateUseCase(this.queryRepo).execute({
      businessId: p.businessId,
      date:       parsed.data.date,
      timezone:   p.timezone,
    })

    if (result.error || !result.data) return { success: false, result: result.error ?? 'Error al consultar citas.' }

    if (!result.data.length) {
      return { success: true, result: `No hay citas para el ${parsed.data.date}.` }
    }

    const lines = result.data.map((s) => `• ${s.time} — ${s.clientName} (${s.serviceName})`)
    return { success: true, result: `Citas del ${parsed.data.date}:\n${lines.join('\n')}` }
  }

  private async getServices(p: ToolExecuteParams): Promise<ExecResult> {
    const result = await this.serviceRepo.getActive(p.businessId)
    if (result.error || !result.data) return { success: false, result: 'No pude obtener los servicios.' }
    if (!result.data.length) return { success: true, result: 'No hay servicios configurados.' }

    const lines = result.data.map((s) => `• ${s.name} (${s.duration_min} min, $${s.price})`)
    return { success: true, result: `Servicios disponibles:\n${lines.join('\n')}` }
  }
}
