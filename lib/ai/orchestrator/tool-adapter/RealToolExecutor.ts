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
import type { BookingEventData } from '../events'
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
  service_id:  z.string().min(1), // accepts UUID or name — resolved fuzzy in resolveService
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

const SearchClientsSchema = z.object({
  query: z.string().min(2).max(80),
})

/**
 * Converts a local datetime (expressed in the given IANA timezone) to a UTC ISO string.
 * Pure Intl — no external dependencies.
 *
 * Without this, naive strings like "2026-04-23T09:00:00" are interpreted as UTC by Postgres,
 * causing a visible clock offset for businesses outside UTC (e.g. UTC-5 shows 9am stored as 9am UTC = 4am local).
 *
 * Algorithm:
 *   1. Treat the local time as UTC (naive epoch)
 *   2. Format that epoch in the target timezone → reveals how much it "drifts" from real local time
 *   3. offsetMs = naive_epoch - drift_epoch
 *   4. True UTC = local_naive_epoch + offsetMs
 */
function localToUTC(date: string, time: string, tz: string): string {
  const naiveAsUTC       = new Date(`${date}T${time}:00Z`)
  const tzStr            = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(naiveAsUTC)
  const tzDisplayedAsUTC = new Date(tzStr.replace(' ', 'T') + 'Z')
  const offsetMs         = naiveAsUTC.getTime() - tzDisplayedAsUTC.getTime()
  return new Date(naiveAsUTC.getTime() + offsetMs).toISOString()
}

/**
 * Tool execution result.
 * Write-tools MUST populate `data` on success — it feeds AppointmentEvent
 * without any string parsing on the caller side.
 */
type ExecResult = { success: boolean; result: string; error?: string; data?: BookingEventData }

/**
 * Result of a fuzzy client lookup.
 * `ambiguous` surfaces candidate names back to the LLM so it can ask which one
 * the user meant instead of silently picking the first match.
 */
type ClientResolution =
  | { status: 'found';     client:     { id: string; name: string } }
  | { status: 'ambiguous'; candidates: { id: string; name: string }[] }
  | { status: 'not_found' }


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
        case 'search_clients':           return this.searchClients(p)
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
  ): Promise<ClientResolution> {
    if (clientId) {
      const res = await this.clientRepo.getById(clientId, businessId)
      if (res.error || !res.data) return { status: 'not_found' }
      return { status: 'found', client: { id: res.data.id, name: res.data.name } }
    }

    if (!clientName) return { status: 'not_found' }

    const allRes = await this.clientRepo.findActiveForAI(businessId)
    if (allRes.error || !allRes.data?.length) return { status: 'not_found' }

    const found = fuzzyFind(allRes.data, clientName)
    if (found.status === 'found') {
      return { status: 'found', client: { id: found.match.id, name: found.match.name } }
    }
    if (found.status === 'ambiguous') {
      return {
        status:     'ambiguous',
        candidates: found.candidates.map((c) => ({ id: c.id, name: c.name })),
      }
    }
    return { status: 'not_found' }
  }

  private async resolveService(
    businessId: string,
    serviceId: string,
  ): Promise<{ id: string; duration_min: number; name: string } | null> {
    const res = await this.serviceRepo.getActive(businessId)
    if (res.error || !res.data) return null

    // 1. Exact UUID match (normal path)
    const exact = res.data.find((s) => s.id === serviceId)
    if (exact) return { id: exact.id, duration_min: exact.duration_min, name: exact.name }

    // 2. Fuzzy name fallback — LLM sent spoken name instead of UUID
    const fuzzyResult = fuzzyFind(res.data, serviceId)
    if (fuzzyResult.status === 'found') {
      const m = fuzzyResult.match
      return { id: m.id, duration_min: m.duration_min, name: m.name }
    }

    return null
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

    const resolution = await this.resolveClient(p.businessId, client_name, client_id)
    if (resolution.status === 'ambiguous') {
      // Surface candidates to the LLM as a tool result; it will ask the user to pick one.
      const names = resolution.candidates.map((c) => c.name).join(', ')
      return { success: false, result: `Encontré varios clientes con ese nombre: ${names}. ¿Cuál de ellos?` }
    }

    // ── Auto-create path ───────────────────────────────────────────────────
    // Owner/staff flow: if the client doesn't exist in the DB but we have a
    // name, register them and continue with the booking in the same turn.
    // Avoids the "¿está registrado?" dead-end and matches what the LLM system
    // prompt already instructs for the reasoning path.
    let clientFinal: { id: string; name: string }
    if (resolution.status === 'found') {
      clientFinal = resolution.client
    } else {
      if (!client_name || client_id) {
        const label = client_name ?? client_id ?? 'el cliente'
        return { success: false, result: `No encontré al cliente "${label}". ¿Puedes darme el nombre completo?` }
      }
      const created = await new CreateClientUseCase(this.clientRepo).execute({
        businessId: p.businessId,
        name:       client_name,
      })
      if (created.error || !created.data) {
        return { success: false, result: created.error ?? `No pude registrar a ${client_name}.` }
      }
      logger.info('REAL-TOOL-EXECUTOR', 'Auto-created client from confirm_booking', {
        businessId: p.businessId,
        clientId:   created.data.id,
        name:       created.data.name,
      })
      clientFinal = { id: created.data.id, name: created.data.name }
    }

    const service = await this.resolveService(p.businessId, service_id)
    if (!service) {
      return { success: false, result: 'No encontré el servicio seleccionado.' }
    }

    // Convert business-local datetime to UTC before writing to DB.
    // Bare strings like "2026-04-23T09:00:00" are stored as 9am UTC by Postgres,
    // causing a visible clock offset for businesses in non-UTC timezones.
    const startISO = localToUTC(date, time, p.timezone)
    const endISO   = this.buildEndISO(startISO, service.duration_min)

    // Hard pre-validation: check for booking conflicts at the DB level.
    // The LLM is instructed to call get_available_slots first, but this guard
    // enforces slot availability even if that step was skipped.
    const conflictsRes = await this.queryRepo.findConflicts(p.businessId, startISO, endISO)
    if (!conflictsRes.error && conflictsRes.data && conflictsRes.data.length > 0) {
      return {
        success: false,
        result:  `El horario ${time} del ${date} ya está ocupado. Llama get_available_slots para ver los horarios libres.`,
      }
    }

    const result = await new CreateAppointmentUseCase(this.queryRepo, this.commandRepo).execute({
      businessId:     p.businessId,
      clientId:       clientFinal.id,
      serviceIds:     [service.id],  // use resolved canonical ID (handles fuzzy name→UUID)
      startAt:        startISO,
      endAt:          endISO,
      assignedUserId: staff_id ?? null,
    })

    if (result.error) return { success: false, result: result.error }

    return {
      success: true,
      result:  `Listo. Agendé a ${clientFinal.name} para ${service.name} el ${date} a las ${time}.`,
      data: {
        appointmentId: result.data?.id ?? '',
        clientName:    clientFinal.name,
        serviceName:   service.name,
        date,
        time,
        action:        'created',
      },
    }
  }

  private async cancelBooking(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = CancelBookingSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito el ID de la cita para cancelarla.' }
    }

    // Fetch appointment details BEFORE cancelling to populate structured event data.
    // getForEdit returns client_id, service_id, start_at — enough to resolve names.
    const appt = await this.queryRepo.getForEdit(parsed.data.appointment_id, p.businessId)
    if (appt.error || !appt.data) {
      return { success: false, result: 'No encontré la cita a cancelar.' }
    }

    // Resolve client name (best-effort — cancel must not fail if client is missing)
    let clientName = 'Cliente'
    if (appt.data.client_id) {
      const clientRes = await this.clientRepo.getById(appt.data.client_id, p.businessId)
      if (!clientRes.error && clientRes.data) clientName = clientRes.data.name
    }

    // Resolve service name (best-effort)
    let serviceName = 'Servicio'
    const firstServiceId = appt.data.appointment_services[0]?.service_id ?? appt.data.service_id
    if (firstServiceId) {
      const svc = await this.resolveService(p.businessId, firstServiceId)
      if (svc) serviceName = svc.name
    }

    // Extract date/time from start_at ISO string
    const startDate = appt.data.start_at.slice(0, 10)           // YYYY-MM-DD
    const startTime = appt.data.start_at.slice(11, 16)          // HH:mm

    const result = await new CancelAppointmentUseCase(this.commandRepo).execute({
      businessId:    p.businessId,
      appointmentId: parsed.data.appointment_id,
    })

    if (result.error) return { success: false, result: result.error }

    return {
      success: true,
      result:  `Listo. La cita de ${clientName} (${serviceName}) ha sido cancelada.`,
      data: {
        appointmentId: parsed.data.appointment_id,
        clientName,
        serviceName,
        date:   startDate,
        time:   startTime,
        action: 'cancelled',
      },
    }
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

    // Resolve service for duration and name
    let durationMin = 60
    let serviceName = 'Servicio'
    const firstServiceId = appt.data.appointment_services[0]?.service_id ?? appt.data.service_id
    if (firstServiceId) {
      const svc = await this.resolveService(p.businessId, firstServiceId)
      if (svc) {
        durationMin = svc.duration_min
        serviceName = svc.name
      }
    }

    // Resolve client name (best-effort)
    let clientName = 'Cliente'
    if (appt.data.client_id) {
      const clientRes = await this.clientRepo.getById(appt.data.client_id, p.businessId)
      if (!clientRes.error && clientRes.data) clientName = clientRes.data.name
    }

    const newStartISO = localToUTC(parsed.data.new_date, parsed.data.new_time, p.timezone)
    const newEndISO   = this.buildEndISO(newStartISO, durationMin)

    // Pre-validate new slot — exclude the appointment being rescheduled from the conflict check.
    const conflictsRes = await this.queryRepo.findConflicts(
      p.businessId, newStartISO, newEndISO, parsed.data.appointment_id,
    )
    if (!conflictsRes.error && conflictsRes.data && conflictsRes.data.length > 0) {
      return {
        success: false,
        result:  `El horario ${parsed.data.new_time} del ${parsed.data.new_date} ya está ocupado. Llama get_available_slots para ver los horarios libres.`,
      }
    }

    const result = await new RescheduleAppointmentUseCase(this.queryRepo, this.commandRepo).execute({
      businessId:    p.businessId,
      appointmentId: parsed.data.appointment_id,
      newStartAt:    newStartISO,
      newEndAt:      newEndISO,
    })

    if (result.error) return { success: false, result: result.error }

    return {
      success: true,
      result:  `Listo. La cita de ${clientName} fue reagendada para el ${parsed.data.new_date} a las ${parsed.data.new_time}.`,
      data: {
        appointmentId: parsed.data.appointment_id,
        clientName,
        serviceName,
        date:   parsed.data.new_date,
        time:   parsed.data.new_time,
        action: 'rescheduled',
      },
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
    // IMPORTANT: use `p.timezone` (business timezone) via Intl.DateTimeFormat, NOT
    // toLocaleDateString() which relies on the server's local timezone and would
    // silently give the wrong weekday when the server runs in UTC.
    // `T12:00:00Z` anchors to UTC noon — safe in all timezones (no midnight crossing).
    const dayOfWeek = new Intl.DateTimeFormat('en-US', {
      weekday:  'long',
      timeZone: p.timezone,
    }).format(new Date(`${parsed.data.date}T12:00:00Z`)).toLowerCase()
    const isConfigured = p.workingHours !== undefined
    const dayHours     = p.workingHours?.[dayOfWeek] ?? null

    // Solo considerar "cerrado" si el día está EXPLÍCITAMENTE en el objeto con valor falsy.
    // Si la key no existe (día no configurado), NO bloquear — continuar flujo normal.
    // "Sin dato" ≠ "Cerrado": un horario parcial (ej: solo lunes-viernes) no debe
    // reportar sábado como cerrado si el dueño simplemente no lo configuró.
    const dayExplicitlyClosed =
      isConfigured &&
      Object.prototype.hasOwnProperty.call(p.workingHours, dayOfWeek) &&
      !dayHours

    if (dayExplicitlyClosed) {
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

  private async searchClients(p: ToolExecuteParams): Promise<ExecResult> {
    const parsed = SearchClientsSchema.safeParse(p.args)
    if (!parsed.success) {
      return { success: false, result: 'Necesito al menos 2 caracteres para buscar clientes.' }
    }

    const allRes = await this.clientRepo.findActiveForAI(p.businessId)
    if (allRes.error || !allRes.data?.length) {
      return {
        success: true,
        result: `No hay clientes registrados aún. "${parsed.data.query}" es un cliente nuevo — llama create_client con name: "${parsed.data.query}" para registrarlo y obtener su client_id.`,
      }
    }

    const found = fuzzyFind(allRes.data, parsed.data.query)

    if (found.status === 'found') {
      return {
        success: true,
        result: `Cliente encontrado: ${found.match.name} (client_id: ${found.match.id}). Usa este client_id en confirm_booking.`,
      }
    }

    if (found.status === 'ambiguous') {
      const list = found.candidates.map((c) => `${c.name} (client_id: ${c.id})`).join(', ')
      return {
        success: true,
        result: `Encontré varios clientes con ese nombre: ${list}. Pregunta al usuario cuál es el correcto antes de continuar.`,
      }
    }

    return {
      success: true,
      result: `No encontré ningún cliente con el nombre "${parsed.data.query}" — es un cliente nuevo. Llama create_client con name: "${parsed.data.query}" para registrarlo.`,
    }
  }
}
