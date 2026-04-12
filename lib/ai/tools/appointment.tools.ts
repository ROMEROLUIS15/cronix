/**
 * appointment.tools.ts — AI tools for appointment read/write operations.
 */

import { z } from 'zod'
import { startOfDay, endOfDay, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { fuzzyFind } from '@/lib/ai/fuzzy-match'
import { logger } from '@/lib/logger'
import {
  notificationForAppointmentCreated,
  notificationForAppointmentCancelled,
} from '@/lib/use-cases/notifications.use-case'
import type { ToolContext } from './_context'
import {
  toLocalDateString,
  fmtUserDate,
  hasTimeComponent,
  calcEndISO,
  validateApptDate,
  fireToolNotification,
} from './_helpers'

// ── SCHEMAS ────────────────────────────────────────────────────────────────

export const GetUpcomingGapsSchema = z.object({
  business_id: z.string().uuid(),
  timezone: z.string().optional(),
})

export const CancelAppointmentSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
  appointment_date: z.string().optional(),
  timezone: z.string().optional(),
})

export const BookAppointmentSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
  service_name: z.string().min(2),
  date: z.string().min(10), // Expecting ISO or similar
  staff_name: z.string().optional(),
  timezone: z.string().optional(),
})

export const RescheduleAppointmentSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
  new_date: z.string().min(10),
  old_date: z.string().optional(),
  timezone: z.string().optional(),
})

export const GetMonthlyForecastSchema = z.object({
  business_id: z.string().uuid(),
})

// ── READ: Citas de una fecha específica ───────────────────────────────────

export const GetAppointmentsByDateSchema = z.object({
  business_id: z.string().uuid(),
  date:        z.string().min(10), // ISO date YYYY-MM-DD or full ISO — LLM computes this
  timezone:    z.string().optional(),
})

export async function get_appointments_by_date(
  args: z.infer<typeof GetAppointmentsByDateSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetAppointmentsByDateSchema.safeParse(args)
  if (!parse.success) return `Error de parámetros: ${parse.error.message}`
  const { business_id, date, timezone = 'UTC' } = parse.data

  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  // Extract YYYY-MM-DD regardless of whether LLM sent full ISO or just the date
  const dateStr = date.split('T')[0]
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return 'Fecha inválida. Proporciona una fecha en formato YYYY-MM-DD.'
  }

  const result = await ctx.appointmentRepo.getDayAppointments(business_id, dateStr)

  if (result.error || !result.data) {
    logger.error('TOOL-DB', `get_appointments_by_date failed: ${result.error}`, { business_id, dateStr })
    return 'Error al consultar la agenda. Intenta de nuevo en un momento.'
  }

  const appts = result.data.filter(a => a.status !== 'cancelled')
  const dateLabel = fmtUserDate(`${dateStr}T12:00:00`, timezone, "EEEE d 'de' MMMM")

  if (!appts.length) return `No hay citas programadas para el ${dateLabel}.`

  const list = appts
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map(a => {
      const timeStr    = fmtUserDate(a.start_at, timezone, 'h:mm a')
      const clientName = (a.client as { name: string } | null)?.name ?? 'Cliente'
      const svcName    = (a.service as { name: string } | null)?.name
        ?? (a.appointment_services as { service: { name: string } }[] | null)?.[0]?.service?.name
        ?? 'Servicio'
      return `- ${timeStr}: ${clientName} (${svcName})`
    })
    .join('\n')

  return `Citas para el ${dateLabel} — ${appts.length} en total:\n${list}`
}

// ── READ: Huecos libres hoy ────────────────────────────────────────────────

export async function get_upcoming_gaps(
  args: z.infer<typeof GetUpcomingGapsSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetUpcomingGapsSchema.safeParse(args)
  if (!parse.success) return `Error de parámetros: ${parse.error.message}`
  const { business_id, timezone = 'UTC' } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try {
    await ctx.tenantGuard.verify(business_id)
  } catch {
    return 'No autorizado para acceder a esta información.'
  }

  const todayStart = startOfDay(new Date()).toISOString()
  const todayEnd   = endOfDay(new Date()).toISOString()

  const result = await ctx.appointmentRepo.findByDateRange(
    business_id,
    todayStart,
    todayEnd,
    ['pending', 'confirmed']
  )

  if (result.error || !result.data) {
    logger.error('TOOL-DB', `get_upcoming_gaps failed: ${result.error}`, { business_id })
    return 'Error al consultar la agenda de hoy. Intenta de nuevo en un momento.'
  }

  const appts = result.data
  if (!appts.length) return 'Toda la agenda de hoy está libre, no hay citas programadas.'

  const fmt     = (d: string) => fmtUserDate(d, timezone, 'h:mm a')
  const bloques = appts.map(a => `${fmt(a.start_at)} a ${fmt(a.end_at)}`)
  return `Los bloques OCUPADOS hoy son: ${bloques.join(', ')}. El resto del horario está disponible.`
}

// ── WRITE: Cancelar cita ──────────────────────────────────────────────────

export async function cancel_appointment(
  args: z.infer<typeof CancelAppointmentSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = CancelAppointmentSchema.safeParse(args)
  if (!parse.success) return `Datos inválidos: ${parse.error.issues[0]?.message}`
  const { business_id, client_name, appointment_date, timezone = 'UTC' } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  try {
    const clientsResult = await ctx.clientRepo.findActiveForAI(business_id)
    if (clientsResult.error || !clientsResult.data) return 'Error al buscar clientes.'

    const clientMatch = fuzzyFind(clientsResult.data, client_name)
    if (clientMatch.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
    if (clientMatch.status === 'ambiguous') return `Encontré varios clientes parecidos: ${clientMatch.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

    const client      = clientMatch.match
    const apptsResult = await ctx.appointmentRepo.findUpcomingByClient(business_id, client.id)
    if (apptsResult.error || !apptsResult.data) return 'Error al buscar citas del cliente.'

    const appts = apptsResult.data
    if (!appts.length) return `${client.name} no tiene citas próximas activas.`

    let target = appts[0]

    if (appointment_date) {
      const targetLocalDate = appointment_date.split('T')[0]
      const found = appts.find(a => toLocalDateString(a.start_at, timezone) === targetLocalDate)
      if (!found || !targetLocalDate) return `No encontré una cita de ${client.name} para esa fecha. Consulta sus citas próximas para confirmar la fecha correcta.`
      target = found
    } else if (appts.length > 1) {
      const list = appts.map(a => {
        const svc     = (a.services as { name: string } | null)?.name ?? 'Servicio'
        const dateStr = fmtUserDate(a.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
        return `- ${svc} el ${dateStr}`
      }).join('\n')
      return `${client.name} tiene varias citas próximas:\n${list}\n¿Cuál deseas cancelar?`
    }

    if (!target) return `${client.name} no tiene citas próximas activas.`

    const serviceName = (target.services as { name: string } | null)?.name ?? 'servicio'
    const dateStr     = fmtUserDate(target.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")

    const cancelResult = await ctx.appointmentRepo.updateStatus(target.id, 'cancelled', business_id)
    if (cancelResult.error) return 'No pude cancelar la cita por un error técnico.'

    const notifInput = notificationForAppointmentCancelled(business_id, client.name, serviceName)
    void fireToolNotification(ctx, business_id, notifInput.title, notifInput.content, notifInput.type)

    return `Listo. Cancelé la cita de ${client.name} (${serviceName}) del ${dateStr}.`
  } catch (err: unknown) {
    logger.error('TOOL-DB', `cancel_appointment failed: ${err instanceof Error ? err.message : String(err)}`, { business_id, client_name })
    return 'No pude cancelar la cita por un error técnico.'
  }
}

// ── WRITE: Agendar cita ────────────────────────────────────────────────────

export async function book_appointment(
  args: z.infer<typeof BookAppointmentSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = BookAppointmentSchema.safeParse(args)
  if (!parse.success) return `Error en los datos de la cita: ${parse.error.issues[0]?.message}`
  const { business_id, client_name, service_name, date, staff_name, timezone = 'UTC' } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  try {
    if (!hasTimeComponent(date)) {
      return 'Error: No proporcionaste una hora específica. Por favor, pregunta al usuario a qué hora desea la cita antes de agendar.'
    }

    const dateError = validateApptDate(date)
    if (dateError) return dateError

    const [clientsResult, servicesResult] = await Promise.all([
      ctx.clientRepo.findActiveForAI(business_id),
      ctx.serviceRepo.getActive(business_id),
    ])

    if (clientsResult.error || !clientsResult.data)   return 'Error al buscar clientes.'
    if (servicesResult.error || !servicesResult.data) return 'Error al buscar servicios.'

    const clientMatch  = fuzzyFind(clientsResult.data, client_name)
    const serviceMatch = fuzzyFind(servicesResult.data, service_name)

    if (clientMatch.status !== 'found')  return `No encontré al cliente ${client_name}.`
    if (serviceMatch.status !== 'found') return `No encontré el servicio ${service_name}.`

    const client  = clientMatch.match
    const service = serviceMatch.match as { id: string; name: string; duration_min: number }

    let staff: { id: string; name: string } | null = null
    if (staff_name) {
      const teamResult = await ctx.userRepo.findActiveStaff(business_id)
      if (teamResult.data) {
        const staffMatch = fuzzyFind(teamResult.data, staff_name)
        if (staffMatch.status === 'found') staff = staffMatch.match as { id: string; name: string }
      }
    }

    const startISO    = date
    const durationMin = service.duration_min ?? 60
    const endISO      = calcEndISO(startISO, durationMin)

    const conflictsResult = await ctx.appointmentRepo.findConflicts(business_id, startISO, endISO)
    if (conflictsResult.error || !conflictsResult.data) return 'Error verificando disponibilidad.'
    if (conflictsResult.data.length > 0) {
      return `Ese horario ya está ocupado, hay ${conflictsResult.data.length} cita(s) que se solapan. Sugiere al usuario otro horario o consulta los espacios disponibles.`
    }

    const createResult = await ctx.appointmentRepo.create({
      business_id,
      client_id:        client.id,
      service_ids:      [service.id],
      assigned_user_id: staff?.id ?? null,
      start_at:         startISO,
      end_at:           endISO,
      notes:            null,
      status:           'pending',
      is_dual_booking:  false,
    })

    if (createResult.error) return 'Hubo un error técnico al crear la cita en la base de datos.'

    const apptTimeStr = fmtUserDate(startISO, timezone, 'h:mm a')
    const apptDateStr = fmtUserDate(startISO, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")

    const notifInput = notificationForAppointmentCreated(business_id, client.name, service.name, apptTimeStr)
    void fireToolNotification(ctx, business_id, notifInput.title, notifInput.content, notifInput.type)

    const staffStr = staff_name ? ` con ${staff_name}` : ''
    return `Listo. Agendé a ${client.name} para ${service.name}${staffStr} el ${apptDateStr}.`
  } catch (err: unknown) {
    logger.error('TOOL-DB', `book_appointment failed: ${err instanceof Error ? err.message : String(err)}`, { business_id, client_name })
    return 'Hubo un error técnico al crear la cita en la base de datos.'
  }
}

// ── WRITE: Reagendar cita ──────────────────────────────────────────────────

export async function reschedule_appointment(
  args: z.infer<typeof RescheduleAppointmentSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = RescheduleAppointmentSchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.issues[0]?.message}`
  const { business_id, client_name, new_date, old_date, timezone = 'UTC' } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  if (!hasTimeComponent(new_date)) {
    return 'Error: No proporcionaste una hora específica para la nueva cita. Pregunta al usuario a qué hora desea reagendar.'
  }

  const dateError = validateApptDate(new_date)
  if (dateError) return dateError

  const clientsResult = await ctx.clientRepo.findActiveForAI(business_id)
  if (clientsResult.error || !clientsResult.data) return 'Error al buscar clientes.'

  const clientMatch = fuzzyFind(clientsResult.data, client_name)
  if (clientMatch.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (clientMatch.status === 'ambiguous') return `Encontré varios clientes parecidos: ${clientMatch.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client      = clientMatch.match
  const apptsResult = await ctx.appointmentRepo.findUpcomingByClient(business_id, client.id)
  if (apptsResult.error || !apptsResult.data) return 'Error al buscar las citas del cliente.'

  const appts = apptsResult.data
  if (!appts.length) return `${client.name} no tiene citas próximas activas para reagendar.`

  let oldAppt = appts[0]

  if (old_date) {
    const targetLocalDate = old_date.split('T')[0]
    const found = appts.find(a => toLocalDateString(a.start_at, timezone) === targetLocalDate)
    if (!found || !targetLocalDate) return `No encontré una cita de ${client.name} para esa fecha. Consulta sus citas próximas para confirmar la fecha correcta.`
    oldAppt = found
  } else if (appts.length > 1) {
    const list = appts.map(a => {
      const svc     = (a.services as { name: string } | null)?.name ?? 'Servicio'
      const dateStr = fmtUserDate(a.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
      return `- ${svc} el ${dateStr}`
    }).join('\n')
    return `${client.name} tiene varias citas próximas:\n${list}\n¿Cuál deseas reagendar?`
  }

  if (!oldAppt) return `${client.name} no tiene citas próximas activas para reagendar.`

  const serviceName = (oldAppt.services as { name: string } | null)?.name ?? 'servicio'
  const durationMin = (oldAppt.services as { duration_min: number } | null)?.duration_min ?? 60
  const newStartISO = new_date
  const newEndISO   = calcEndISO(newStartISO, durationMin)

  const conflictsResult = await ctx.appointmentRepo.findConflicts(business_id, newStartISO, newEndISO, oldAppt.id)
  if (conflictsResult.error || !conflictsResult.data) return 'Error verificando disponibilidad.'
  if (conflictsResult.data.length > 0) {
    return `Ese horario ya está ocupado. Hay ${conflictsResult.data.length} cita(s) que se solapan. Sugiere otro horario al usuario.`
  }

  const rescheduleResult = await ctx.appointmentRepo.reschedule(oldAppt.id, newStartISO, newEndISO, business_id)
  if (rescheduleResult.error) {
    logger.error('TOOL-DB', `reschedule_appointment failed: ${rescheduleResult.error}`, { business_id })
    return 'No pude reagendar la cita por un error técnico.'
  }

  const oldDateStr = fmtUserDate(oldAppt.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
  const newDateStr = fmtUserDate(newStartISO,       timezone, "EEEE d 'de' MMMM 'a las' h:mm a")

  void fireToolNotification(ctx, business_id, 'Cita Reagendada', `${client.name} movió su cita de ${serviceName} del ${oldDateStr} al ${newDateStr}`, 'info')

  return `Listo. Reagendé la cita de ${client.name} (${serviceName}) del ${oldDateStr} al ${newDateStr}.`
}

// ── STRATEGIC: Proyección mensual ─────────────────────────────────────────

export async function get_monthly_forecast(
  args: z.infer<typeof GetMonthlyForecastSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetMonthlyForecastSchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.message}`
  const { business_id } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const now          = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

  const [apptsResult, servicesResult, txsResult] = await Promise.all([
    ctx.appointmentRepo.findByDateRange(business_id, now.toISOString(), endOfMonth, ['pending', 'confirmed']),
    ctx.serviceRepo.getActive(business_id),
    ctx.financeRepo.findByPaidAtRange(business_id, startOfMonth, now.toISOString()),
  ])

  if (apptsResult.error   || !apptsResult.data)   return 'Error al calcular la proyección mensual.'
  if (servicesResult.error || !servicesResult.data) return 'No pude obtener los precios de los servicios.'
  if (txsResult.error     || !txsResult.data)     return 'Error al calcular la proyección mensual.'

  const projectedRevenue = apptsResult.data.reduce((acc, a) => {
    const svc = servicesResult.data!.find(s => s.id === a.id)
    return acc + Number(svc?.price ?? 0)
  }, 0)

  const actualRevenue = txsResult.data.reduce((acc, t) => acc + Number(t.net_amount), 0)
  const totalMonth    = actualRevenue + projectedRevenue
  const monthName     = format(now, 'MMMM', { locale: es })

  return `Para el mes de ${monthName}, ya has facturado $${actualRevenue.toLocaleString('es-CO')}. Basado en las citas agendadas faltantes, proyectamos cerrar el mes con un total de $${totalMonth.toLocaleString('es-CO')}.`
}
