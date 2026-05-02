/**
 * BookingEngine.ts — Única fuente de verdad para operaciones de citas con IA.
 *
 * REEMPLAZA la lógica duplicada entre:
 *   - lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts (dashboard)
 *   - lib/ai/tools/appointment.tools.ts (legacy)
 *   - supabase/functions/process-whatsapp/tool-executor.ts (whatsapp)
 *
 * INVARIANTES:
 *   1. Solo acepta TenantContext — verificación de tenant es estructural.
 *   2. Valida con Zod ANTES de cualquier operación de BD.
 *   3. Convierte timezone una sola vez, en la capa correcta (antes de escribir).
 *   4. Nunca lanza — todos los errores son ToolResult.
 *   5. Invalida el cache después de cada escritura exitosa.
 *
 * Los channel adapters (Dashboard, WhatsApp) delegan aquí.
 * La única diferencia entre canales está en cómo llegan los args y cómo
 * se formatea la respuesta — la lógica de negocio es idéntica.
 */

import { z } from 'zod'
import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'
import type { IClientRepository }  from '@/lib/domain/repositories/IClientRepository'
import type { IServiceRepository } from '@/lib/domain/repositories/IServiceRepository'
import type { TenantContext }      from '../security/TenantEnforcer'
import type { ToolResult, BookingData } from '../contracts/tool-result'
import { toolOk, toolFail }        from '../contracts/tool-result'
import {
  ConfirmBookingSchema,
  CancelBookingSchema,
  RescheduleBookingSchema,
  GetAvailableSlotsSchema,
  GetByDateSchema,
  CreateClientSchema,
  SearchClientsSchema,
} from '../contracts/tool-schemas'
import { ClientResolver }  from './ClientResolver'
import { ServiceResolver } from './ServiceResolver'
import { localToUTC, addMinutesToISO, formatLocalDateTime, toLocalDateString } from '../utils/timezone'
import { CreateAppointmentUseCase }     from '@/lib/domain/use-cases/CreateAppointmentUseCase'
import { CancelAppointmentUseCase }     from '@/lib/domain/use-cases/CancelAppointmentUseCase'
import { RescheduleAppointmentUseCase } from '@/lib/domain/use-cases/RescheduleAppointmentUseCase'
import { GetAppointmentsByDateUseCase } from '@/lib/domain/use-cases/GetAppointmentsByDateUseCase'
import { GetAvailableSlotsUseCase }     from '@/lib/domain/use-cases/GetAvailableSlotsUseCase'
import { CreateClientUseCase }          from '@/lib/domain/use-cases/CreateClientUseCase'
import { fuzzyFind, similarity, normalizeForFuzzy } from '@/lib/ai/fuzzy-match'
import { logger } from '@/lib/logger'
import cache      from '@/lib/cache'

// ── Dependencias ──────────────────────────────────────────────────────────────

export type BookingEngineRepos = {
  appointmentQuery:   IAppointmentQueryRepository
  appointmentCommand: IAppointmentCommandRepository
  clients:            IClientRepository
  services:           IServiceRepository
}

// ── WorkingHours (opcional — permite responder "el negocio está cerrado") ─────

type DayHours = { open: string; close: string } | null
type WorkingHours = Record<string, DayHours>

// ── BookingEngine ─────────────────────────────────────────────────────────────

export class BookingEngine {
  private clientResolver:  ClientResolver
  private serviceResolver: ServiceResolver

  constructor(private repos: BookingEngineRepos) {
    this.clientResolver  = new ClientResolver(repos.clients)
    this.serviceResolver = new ServiceResolver(repos.services)
  }

  // ── WRITE: Crear cita ───────────────────────────────────────────────────────
  //
  // Flujo completo:
  //   1. Validar schema Zod
  //   2. Resolver cliente (nombre → ID o crear si no existe)
  //   3. Resolver servicio (nombre o UUID → ServiceForDropdown)
  //   4. Convertir timezone local → UTC
  //   5. Verificar conflictos + crear (atómico vía UseCase)
  //   6. Invalidar cache
  //   7. Retornar ToolResult<BookingData>

  async createAppointment(
    ctx:          TenantContext,
    rawArgs:      unknown,
    opts?: {
      /** Si true: crear el cliente automáticamente cuando no se encuentre. Default: true */
      autoCreateClient?: boolean
      workingHours?:     WorkingHours
      staffId?:          string
    },
  ): Promise<ToolResult<BookingData>> {
    // ── 1. Validar schema ────────────────────────────────────────────────────
    const parsed = ConfirmBookingSchema.safeParse(rawArgs)
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      return toolFail('INVALID_ARGS', `Datos incompletos para agendar: ${fields}`)
    }
    const { service_id, date, time, client_name, client_id, staff_id } = parsed.data

    // ── 2. Resolver cliente ──────────────────────────────────────────────────
    let clientFinal: { id: string; name: string }

    const clientRes = await this.clientResolver.resolve(ctx, { clientId: client_id, clientName: client_name })

    if (clientRes.status === 'ambiguous') {
      return toolFail(
        'CLIENT_AMBIGUOUS',
        `Encontré varios clientes similares: ${clientRes.candidates.map((c) => c.name).join(', ')}. ¿A cuál te refieres?`,
        clientRes.candidates.map((c) => c.name),
      )
    }

    if (clientRes.status === 'not_found') {
      const autoCreate = opts?.autoCreateClient ?? true
      if (!autoCreate || !client_name) {
        const label = client_name ?? client_id ?? 'el cliente'
        return toolFail('CLIENT_NOT_FOUND', `No encontré al cliente "${label}". ¿Puedes darme el nombre completo?`)
      }

      // Auto-crear cliente: comportamiento del dashboard (owner agrega cliente nuevo en el mismo turno)
      const created = await new CreateClientUseCase(this.repos.clients).execute({
        businessId: ctx.businessId,
        name:       client_name,
      })
      if (created.error || !created.data) {
        return toolFail('DB_ERROR', created.error ?? `No pude registrar a ${client_name}.`)
      }
      logger.info('BOOKING-ENGINE', 'Auto-created client', { businessId: ctx.businessId, name: created.data.name })
      clientFinal = { id: created.data.id, name: created.data.name }
    } else {
      clientFinal = clientRes.client
    }

    // ── 3. Resolver servicio ─────────────────────────────────────────────────
    const serviceRes = await this.serviceResolver.resolve(ctx, service_id)
    if (serviceRes.status === 'not_found') {
      return toolFail('SERVICE_NOT_FOUND', `No encontré el servicio "${service_id}". ¿Puedes verificar el nombre?`)
    }
    if (serviceRes.status === 'ambiguous') {
      return toolFail(
        'SERVICE_NOT_FOUND',
        `Encontré varios servicios similares: ${serviceRes.candidates.map((s) => s.name).join(', ')}. ¿Cuál es?`,
        serviceRes.candidates.map((s) => s.name),
      )
    }
    const service = serviceRes.service

    // ── 4. Convertir timezone ────────────────────────────────────────────────
    const startISO = localToUTC(date, time, ctx.timezone)
    const endISO   = addMinutesToISO(startISO, service.duration_min)

    // ── 5. Crear cita (conflict check + insert atómico en el UseCase) ────────
    const result = await new CreateAppointmentUseCase(
      this.repos.appointmentQuery,
      this.repos.appointmentCommand,
    ).execute({
      businessId:     ctx.businessId,
      clientId:       clientFinal.id,
      serviceIds:     [service.id],
      startAt:        startISO,
      endAt:          endISO,
      assignedUserId: opts?.staffId ?? staff_id ?? null,
    })

    if (result.error) {
      const isConflict = result.error.toLowerCase().includes('ocupado')
        || result.error.toLowerCase().includes('conflict')
      return toolFail(
        isConflict ? 'SLOT_CONFLICT' : 'DB_ERROR',
        isConflict
          ? `El horario ${time} del ${date} ya está ocupado. Consulta get_available_slots para ver horarios libres.`
          : `No pude crear la cita: ${result.error}`,
      )
    }

    // ── 6. Invalidar cache ───────────────────────────────────────────────────
    void cache.invalidate(ctx.businessId, 'appointments')
    void cache.invalidateKey(ctx.businessId, 'dashboard', 'stats')

    const dateLabel = formatLocalDateTime(startISO, ctx.timezone, 'datetime')

    return toolOk(
      {
        appointmentId: result.data!.id,
        clientName:    clientFinal.name,
        serviceName:   service.name,
        date,
        time,
        action:        'created',
      },
      `Listo. Agendé a ${clientFinal.name} para ${service.name} el ${dateLabel}.`,
    )
  }

  // ── WRITE: Cancelar cita ────────────────────────────────────────────────────

  async cancelAppointment(
    ctx:     TenantContext,
    rawArgs: unknown,
  ): Promise<ToolResult<BookingData>> {
    const parsed = CancelBookingSchema.safeParse(rawArgs)
    if (!parsed.success) {
      return toolFail('INVALID_ARGS', 'Necesito el nombre del cliente o el ID de la cita.')
    }

    const resolved = await this.resolveAppointmentId(ctx, parsed.data)
    if ('error' in resolved) return toolFail('APPOINTMENT_NOT_FOUND', resolved.error)

    // Obtener detalles antes de cancelar (para el evento y la respuesta)
    const apptDetails = await this.repos.appointmentQuery.getForEdit(resolved.id, ctx.businessId)
    if (apptDetails.error || !apptDetails.data) {
      return toolFail('APPOINTMENT_NOT_FOUND', 'No encontré la cita a cancelar.')
    }

    const clientName  = await this.resolveClientName(ctx, apptDetails.data.client_id)
    const serviceName = await this.resolveServiceName(ctx, apptDetails.data)
    const startDate   = apptDetails.data.start_at.slice(0, 10)
    const startTime   = apptDetails.data.start_at.slice(11, 16)

    const result = await new CancelAppointmentUseCase(this.repos.appointmentCommand).execute({
      businessId:    ctx.businessId,
      appointmentId: resolved.id,
    })

    if (result.error) {
      return toolFail('DB_ERROR', `No pude cancelar la cita: ${result.error}`)
    }

    void cache.invalidate(ctx.businessId, 'appointments')
    void cache.invalidateKey(ctx.businessId, 'dashboard', 'stats')

    return toolOk(
      { appointmentId: resolved.id, clientName, serviceName, date: startDate, time: startTime, action: 'cancelled' },
      `Listo. Cancelé la cita de ${clientName} (${serviceName}).`,
    )
  }

  // ── WRITE: Reagendar cita ───────────────────────────────────────────────────

  async rescheduleAppointment(
    ctx:     TenantContext,
    rawArgs: unknown,
  ): Promise<ToolResult<BookingData>> {
    const parsed = RescheduleBookingSchema.safeParse(rawArgs)
    if (!parsed.success) {
      return toolFail('INVALID_ARGS', 'Necesito el cliente o la cita, y la nueva fecha/hora.')
    }

    const { new_date, new_time } = parsed.data

    const resolved = await this.resolveAppointmentId(ctx, parsed.data)
    if ('error' in resolved) return toolFail('APPOINTMENT_NOT_FOUND', resolved.error)

    const apptDetails = await this.repos.appointmentQuery.getForEdit(resolved.id, ctx.businessId)
    if (apptDetails.error || !apptDetails.data) {
      return toolFail('APPOINTMENT_NOT_FOUND', 'No encontré la cita.')
    }

    const clientName  = await this.resolveClientName(ctx, apptDetails.data.client_id)
    const serviceName = await this.resolveServiceName(ctx, apptDetails.data)
    const durationMin = await this.resolveServiceDuration(ctx, apptDetails.data)

    const newStartISO = localToUTC(new_date, new_time, ctx.timezone)
    const newEndISO   = addMinutesToISO(newStartISO, durationMin)

    // Verificar conflicto excluyendo la cita que se mueve
    const conflicts = await this.repos.appointmentQuery.findConflicts(
      ctx.businessId, newStartISO, newEndISO, resolved.id,
    )
    if (!conflicts.error && (conflicts.data?.length ?? 0) > 0) {
      return toolFail('SLOT_CONFLICT', `El horario ${new_time} del ${new_date} ya está ocupado.`)
    }

    const result = await new RescheduleAppointmentUseCase(
      this.repos.appointmentQuery,
      this.repos.appointmentCommand,
    ).execute({
      businessId:    ctx.businessId,
      appointmentId: resolved.id,
      newStartAt:    newStartISO,
      newEndAt:      newEndISO,
    })

    if (result.error) return toolFail('DB_ERROR', `No pude reagendar: ${result.error}`)

    void cache.invalidate(ctx.businessId, 'appointments')
    void cache.invalidateKey(ctx.businessId, 'dashboard', 'stats')

    const dateLabel = formatLocalDateTime(newStartISO, ctx.timezone, 'datetime')

    return toolOk(
      { appointmentId: resolved.id, clientName, serviceName, date: new_date, time: new_time, action: 'rescheduled' },
      `Listo. Reagendé la cita de ${clientName} para el ${dateLabel}.`,
    )
  }

  // ── READ: Citas por fecha ───────────────────────────────────────────────────

  async getAppointmentsByDate(
    ctx:     TenantContext,
    rawArgs: unknown,
  ): Promise<ToolResult<void>> {
    const parsed = GetByDateSchema.safeParse(rawArgs)
    if (!parsed.success) return toolFail('INVALID_ARGS', 'Necesito una fecha válida (YYYY-MM-DD).')

    const result = await new GetAppointmentsByDateUseCase(this.repos.appointmentQuery).execute({
      businessId: ctx.businessId,
      date:       parsed.data.date,
      timezone:   ctx.timezone,
    })

    if (result.error || !result.data) return toolFail('DB_ERROR', 'Error al consultar citas.')

    if (!result.data.length) {
      const dateLabel = formatLocalDateTime(`${parsed.data.date}T12:00:00Z`, ctx.timezone, 'date')
      return toolOk(undefined, `No hay citas para el ${dateLabel}.`)
    }

    const lines    = result.data.map((s) => `${s.time} — ${s.clientName} (${s.serviceName})`)
    const dateLabel = formatLocalDateTime(`${parsed.data.date}T12:00:00Z`, ctx.timezone, 'date')
    return toolOk(undefined, `Citas del ${dateLabel}:\n${lines.join('\n')}`)
  }

  // ── READ: Horarios disponibles ──────────────────────────────────────────────

  async getAvailableSlots(
    ctx:          TenantContext,
    rawArgs:      unknown,
    workingHours?: WorkingHours,
  ): Promise<ToolResult<void>> {
    const parsed = GetAvailableSlotsSchema.safeParse(rawArgs)
    if (!parsed.success) return toolFail('INVALID_ARGS', 'Necesito la fecha y duración del servicio.')

    const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: ctx.timezone })
      .format(new Date(`${parsed.data.date}T12:00:00Z`))
      .toLowerCase()

    if (workingHours && Object.hasOwn(workingHours, dayOfWeek) && !workingHours[dayOfWeek]) {
      return toolOk(undefined, `El negocio está cerrado ese día.`)
    }

    const dayHours = workingHours?.[dayOfWeek] ?? null

    const result = await new GetAvailableSlotsUseCase(this.repos.appointmentQuery).execute({
      businessId:      ctx.businessId,
      date:            parsed.data.date,
      durationMin:     parsed.data.duration_min,
      workingHours:    dayHours,
      slotIntervalMin: 30,
    })

    if (result.error || !result.data) return toolFail('DB_ERROR', 'Error al consultar disponibilidad.')
    if (!result.data.length) return toolOk(undefined, `No hay horarios disponibles para el ${parsed.data.date}.`)

    const labels = result.data.map((s) => s.label).join(', ')
    return toolOk(undefined, `Horarios disponibles el ${parsed.data.date}: ${labels}.`)
  }

  // ── WRITE: Crear cliente ────────────────────────────────────────────────────

  async createClient(
    ctx:     TenantContext,
    rawArgs: unknown,
  ): Promise<ToolResult<{ id: string; name: string }>> {
    const parsed = CreateClientSchema.safeParse(rawArgs)
    if (!parsed.success) return toolFail('INVALID_ARGS', 'Necesito al menos el nombre del cliente.')

    const result = await new CreateClientUseCase(this.repos.clients).execute({
      businessId: ctx.businessId,
      name:       parsed.data.name,
      phone:      parsed.data.phone,
    })

    if (result.error || !result.data) return toolFail('DB_ERROR', result.error ?? 'No se pudo registrar al cliente.')
    return toolOk({ id: result.data.id, name: result.data.name }, `Cliente "${result.data.name}" registrado.`)
  }

  // ── READ: Buscar clientes ───────────────────────────────────────────────────

  async searchClients(
    ctx:     TenantContext,
    rawArgs: unknown,
  ): Promise<ToolResult<void>> {
    const parsed = SearchClientsSchema.safeParse(rawArgs)
    if (!parsed.success) return toolFail('INVALID_ARGS', 'Necesito al menos 2 caracteres para buscar.')

    const allRes = await this.repos.clients.findActiveForAI(ctx.businessId)
    if (allRes.error || !allRes.data?.length) {
      return toolOk(undefined, `CLIENT_NOT_FOUND: "${parsed.data.query}" no existe. Procede con confirm_booking usando este nombre; se registrará automáticamente.`)
    }

    const found = fuzzyFind(allRes.data, parsed.data.query)

    if (found.status === 'found') {
      return toolOk(undefined, `CLIENT_FOUND: ${found.match.name}. Usa este nombre exacto en confirm_booking.`)
    }
    if (found.status === 'ambiguous') {
      const list = found.candidates.map((c) => c.name).join(', ')
      return toolOk(undefined, `MULTIPLE_CLIENTS: ${list}. Pregunta al usuario cuál prefiere.`)
    }
    return toolOk(undefined, `CLIENT_NOT_FOUND: "${parsed.data.query}" no existe. Procede con confirm_booking usando este nombre; se registrará automáticamente.`)
  }

  // ── Dispatcher principal ────────────────────────────────────────────────────
  // Permite que los adapters llamen un solo método con el nombre del tool.

  async dispatch(
    ctx:         TenantContext,
    toolName:    string,
    rawArgs:     unknown,
    engineOpts?: { workingHours?: WorkingHours; autoCreateClient?: boolean },
  ): Promise<ToolResult<unknown>> {
    try {
      switch (toolName) {
        case 'confirm_booking':          return await this.createAppointment(ctx, rawArgs, engineOpts)
        case 'cancel_booking':           return await this.cancelAppointment(ctx, rawArgs)
        case 'reschedule_booking':       return await this.rescheduleAppointment(ctx, rawArgs)
        case 'get_appointments_by_date': return await this.getAppointmentsByDate(ctx, rawArgs)
        case 'get_available_slots':      return await this.getAvailableSlots(ctx, rawArgs, engineOpts?.workingHours)
        case 'create_client':            return await this.createClient(ctx, rawArgs)
        case 'search_clients':           return await this.searchClients(ctx, rawArgs)
        default:
          return toolFail('INVALID_ARGS', `Tool "${toolName}" no existe.`)
      }
    } catch (err) {
      logger.error('BOOKING-ENGINE', 'Uncaught exception in dispatch', {
        toolName,
        businessId: ctx.businessId,
        error: err instanceof Error ? err.message : String(err),
      })
      return toolFail('DB_ERROR', 'Error interno inesperado. Por favor intenta de nuevo.')
    }
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  /** Resuelve el ID de una cita desde appointment_id directo, o por nombre+fecha */
  private async resolveAppointmentId(
    ctx:  TenantContext,
    args: { appointment_id?: string; client_name?: string; date?: string; time?: string },
  ): Promise<{ id: string } | { error: string }> {
    if (args.appointment_id) {
      // Verificar que la cita pertenezca a este negocio
      const details = await this.repos.appointmentQuery.getForEdit(args.appointment_id, ctx.businessId)
      if (details.error || !details.data) return { error: 'Cita no encontrada en este negocio.' }
      return { id: args.appointment_id }
    }

    if (!args.client_name) return { error: 'Necesito el nombre del cliente o el ID de la cita.' }

    const todayISO  = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
    const targetDay = args.date ?? todayISO

    const dayRes = await new GetAppointmentsByDateUseCase(this.repos.appointmentQuery).execute({
      businessId: ctx.businessId,
      date:       targetDay,
      timezone:   ctx.timezone,
    })

    if (dayRes.error || !dayRes.data?.length) {
      return { error: `No hay citas activas el ${targetDay}.` }
    }

    const needle  = normalizeForFuzzy(args.client_name)
    const matches = dayRes.data
      .map((a) => ({ appt: a, score: similarity(normalizeForFuzzy(a.clientName), needle) }))
      .filter((x) => x.score >= 0.45 || normalizeForFuzzy(x.appt.clientName).includes(needle))
      .sort((a, b) => b.score - a.score)

    if (matches.length === 0) {
      return { error: `No encontré una cita de ${args.client_name} el ${targetDay}.` }
    }
    if (matches.length === 1) {
      return { id: matches[0]!.appt.id }
    }

    const list = matches.slice(0, 3).map((m) => `${m.appt.time} ${m.appt.clientName}`).join(', ')
    return { error: `Hay varias citas: ${list}. ¿Cuál?` }
  }

  private async resolveClientName(ctx: TenantContext, clientId: string): Promise<string> {
    const res = await this.repos.clients.getById(clientId, ctx.businessId)
    return res.data?.name ?? 'Cliente'
  }

  private async resolveServiceName(
    ctx:  TenantContext,
    appt: { service_id: string | null; appointment_services: { service_id: string }[] },
  ): Promise<string> {
    const svcId = appt.appointment_services[0]?.service_id ?? appt.service_id
    if (!svcId) return 'Servicio'
    const res = await this.serviceResolver.resolve(ctx, svcId)
    return res.status === 'found' ? res.service.name : 'Servicio'
  }

  private async resolveServiceDuration(
    ctx:  TenantContext,
    appt: { service_id: string | null; appointment_services: { service_id: string }[] },
  ): Promise<number> {
    const svcId = appt.appointment_services[0]?.service_id ?? appt.service_id
    if (!svcId) return 60
    const res = await this.serviceResolver.resolve(ctx, svcId)
    return res.status === 'found' ? res.service.duration_min : 60
  }
}
