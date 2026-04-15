/**
 * RealToolExecutor.ts — Production IToolExecutor implementation.
 *
 * Replaces MockToolExecutor. Maps tool names to real UseCases backed by
 * Supabase repositories. Zero mocks, zero hardcoded strings.
 *
 * All Zod schemas use snake_case — must match the tool definitions in
 * decision-engine.ts exactly, since the LLM sends exactly those field names.
 *
 * Client resolution: findActiveForAI() + fuzzyFind()
 * Service resolution: getActive() + Array.find() by service_id
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
import { CreateClientUseCase }          from '@/lib/domain/use-cases/CreateClientUseCase'
import { GetAvailableSlotsUseCase }     from '@/lib/domain/use-cases/GetAvailableSlotsUseCase'
import { fuzzyFind }                    from '@/lib/ai/fuzzy-match'
import { logger }                       from '@/lib/logger'

// ── Schemas (snake_case — matches LLM tool definitions exactly) ────────────────

const ConfirmBookingSchema = z.object({
  service_id:  z.string().uuid(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time:        z.string().regex(/^\d{2}:\d{2}$/),
  client_name: z.string().optional(),
  client_id:   z.string().uuid().optional(),
  staff_id:    z.string().uuid().optional(),
})

const CancelBookingSchema = z.object({
  appointment_id: z.string().uuid(),
})

const RescheduleBookingSchema = z.object({
  appointment_id: z.string().uuid(),
  new_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_time:       z.string().regex(/^\d{2}:\d{2}$/),
})

const GetByDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const CreateClientSchema = z.object({
  name:  z.string().min(1).max(120),
  phone: z.string().max(30).optional(),
})

const GetAvailableSlotsSchema = z.object({
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_min: z.number().int().min(5).max(480),
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
        case 'create_client':            return this.createClient(p)
        case 'get_available_slots':      return this.getAvailableSlots(p)
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

    const { service_id, date, time, client_name, client_id, staff_id } = parsed.data

    const client = await this.resolveClient(p.businessId, client_name, client_id)
    if (!client) {
      const label = client_name ?? client_id ?? 'el cliente'
      return { success: false, result: `No encontré al cliente "${label}". ¿Está registrado?` }
    }

    const service = await this.resolveService(p.businessId, service_id)
    if (!service) {
      return { success: false, result: 'No encontré el servicio seleccionado.' }
    }

    const startISO = `${date}T${time}:00`
    const endISO   = this.buildEndISO(startISO, service.duration_min)

    const result = await new CreateAppointmentUseCase(this.queryRepo, this.commandRepo).execute({
      businessId:     p.businessId,
      clientId:       client.id,
      serviceIds:     [service_id],
      startAt:        startISO,
      endAt:          endISO,
      assignedUserId: staff_id ?? null,
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
      appointmentId: parsed.data.appointment_id,
    })

    if (result.error) return { success: false, result: result.error }
    return { success: true, result: 'Listo. La cita ha sido cancelada.' }
  }

  private async rescheduleBooking(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = RescheduleBookingSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito la cita, la nueva fecha y hora para reagendar.' }
    }

    const appt = await this.queryRepo.getForEdit(parsed.data.appointment_id, p.businessId)
    if (appt.error || !appt.data) {
      return { success: false, result: 'No encontré la cita.' }
    }

    let durationMin = 60
    if (appt.data.service_id) {
      const svc = await this.resolveService(p.businessId, appt.data.service_id)
      if (svc) durationMin = svc.duration_min
    }

    const newStartISO = `${parsed.data.new_date}T${parsed.data.new_time}:00`
    const newEndISO   = this.buildEndISO(newStartISO, durationMin)

    const result = await new RescheduleAppointmentUseCase(this.queryRepo, this.commandRepo).execute({
      businessId:    p.businessId,
      appointmentId: parsed.data.appointment_id,
      newStartAt:    newStartISO,
      newEndAt:      newEndISO,
    })

    if (result.error) return { success: false, result: result.error }

    return {
      success: true,
      result: `Listo. La cita fue reagendada para el ${parsed.data.new_date} a las ${parsed.data.new_time}.`,
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

  private async getAvailableSlots(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = GetAvailableSlotsSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito la fecha y duración del servicio para consultar disponibilidad.' }
    }

    // Extract working hours for the requested day of week.
    // Distinguish "not configured" (workingHours undefined) from "explicitly closed"
    // (workingHours defined but day absent/null) — the use case handles them differently.
    const dayOfWeek = new Date(`${parsed.data.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
    const isConfigured = p.workingHours !== undefined
    const dayHours     = p.workingHours?.[dayOfWeek] ?? null

    if (isConfigured && !dayHours) {
      return { success: true, result: `El negocio está cerrado el ${parsed.data.date}. No hay horarios disponibles.` }
    }

    const result = await new GetAvailableSlotsUseCase(this.queryRepo).execute({
      businessId:      p.businessId,
      date:            parsed.data.date,
      durationMin:     parsed.data.duration_min,
      workingHours:    dayHours,
      slotIntervalMin: 30,
    })

    if (result.error || !result.data) return { success: false, result: result.error ?? 'Error al consultar disponibilidad.' }

    if (!result.data.length) {
      return { success: true, result: `No hay horarios disponibles para el ${parsed.data.date}.` }
    }

    const labels = result.data.map((s) => s.label).join(', ')
    return { success: true, result: `Horarios disponibles el ${parsed.data.date}: ${labels}.` }
  }

  private async createClient(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = CreateClientSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito al menos el nombre del cliente para registrarlo.' }
    }

    const result = await new CreateClientUseCase(this.clientRepo).execute({
      businessId: p.businessId,
      name:       parsed.data.name,
      phone:      parsed.data.phone,
    })

    if (result.error || !result.data) return { success: false, result: result.error ?? 'No se pudo registrar al cliente.' }

    return {
      success: true,
      result: `Cliente "${result.data.name}" registrado (client_id: ${result.data.id}). Usa client_id: ${result.data.id} al llamar confirm_booking.`,
    }
  }

  private async getServices(p: ToolExecuteParams): Promise<ExecResult> {
    const result = await this.serviceRepo.getActive(p.businessId)
    if (result.error || !result.data) return { success: false, result: 'No pude obtener los servicios.' }
    if (!result.data.length) return { success: true, result: 'No hay servicios configurados.' }

    const lines = result.data.map((s) => `• ${s.name} (${s.duration_min} min, $${s.price})`)
    return { success: true, result: `Servicios disponibles:\n${lines.join('\n')}` }
  }
}
