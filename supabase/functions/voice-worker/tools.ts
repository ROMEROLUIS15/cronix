/**
 * Tool implementations for the dashboard voice agent.
 *
 * Each tool delegates to direct Supabase queries via the core repos. Tool
 * results are user-facing prose: the agent bypasses LLM synthesis on
 * single-tool success and speaks the tool's `result` string directly.
 *
 * Helpers (fuzzy match, time formatting, repos) live in ./core/ — this file
 * only contains tools, schemas, and the dispatcher.
 */

import type { ToolResult, BookingEventData } from './types.ts'
import type { ToolContext } from './core/tool-context.ts'

import { normalize, tokens } from './core/fuzzy.ts'
import { parseTimeExpression, userMentionedTime } from './core/time-parser.ts'
import { parseDateExpression } from './core/date-parser.ts'
import {
  localToUTC, buildEndISO, humanizeDate, formatTimeFromISO,
} from './core/time-format.ts'
import {
  type ClientRow, getActiveClients, resolveClient, normalisePhone,
} from './core/repos/clients.ts'
import {
  getActiveServices, resolveService,
} from './core/repos/services.ts'
import {
  findConflicts, findAppointmentByClientName, resolveAppointmentServiceId,
} from './core/repos/appointments.ts'

export type { ToolContext } from './core/tool-context.ts'

// ── Tool: smart_schedule ───────────────────────────────────────────────────

interface SmartScheduleArgs {
  service_name: string
  client_name:  string
  date:         string
  time:         string
}

/**
 * Strings the LLM sometimes ships in lieu of asking the user. Treat them as
 * missing — booking without these is the bug the user reported when the
 * assistant scheduled "Gardi para el 21" with no service or time.
 */
const SCHEDULE_PLACEHOLDER = /^(?:\?+|tbd|pendiente|por\s+definir|n\/a|none|null|undefined|sin\s+(?:especificar|definir)|no\s+especificad[oa])$/i

function isScheduleParamMissing(value: string | undefined): boolean {
  if (!value) return true
  const t = value.trim()
  if (t.length === 0) return true
  return SCHEDULE_PLACEHOLDER.test(t)
}

function firstMissingScheduleParam(args: {
  client_name?: string; service_name?: string; date?: string; time?: string
}): string | null {
  if (isScheduleParamMissing(args.client_name))  return 'el nombre del cliente'
  if (isScheduleParamMissing(args.service_name)) return 'el servicio'
  if (isScheduleParamMissing(args.date))         return 'la fecha'
  if (isScheduleParamMissing(args.time))         return 'la hora'
  return null
}

async function smartSchedule(ctx: ToolContext, args: SmartScheduleArgs): Promise<ToolResult> {
  let { service_name, client_name, date, time } = args

  // Deterministic date/time override: prefer what the user actually said
  // (parsed from the corpus) over what the LLM emitted. Llama 3.x has a
  // strong bias for "09:00" and "today" when it lacks a real value, which
  // is exactly what was producing bookings at hours the user never named.
  if (ctx.userTextCorpus) {
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
    const userDate = parseDateExpression(ctx.userTextCorpus, todayLocal)?.date
    const userTime = parseTimeExpression(ctx.userTextCorpus)?.time
    if (userDate && userDate !== date) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule date override: LLM="${date}" → user="${userDate}"`)
      date = userDate
    }
    if (userTime && userTime !== time) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule time override: LLM="${time}" → user="${userTime}"`)
      time = userTime
    }
  }

  const missingLabel = firstMissingScheduleParam({ client_name, service_name, date, time })
  if (missingLabel) {
    return { success: false, result: `Para agendar necesito ${missingLabel}. ¿Me lo dices?` }
  }

  // Anti-hallucination guards: each of the four schedule params must trace
  // back to something the user actually said this turn (or recently in
  // history). Llama 3.x routinely fills missing slots with plausible
  // defaults — most often 09:00 for time and today for date — which is how
  // bookings were ending up at the wrong hour or wrong day.
  if (ctx.userTextCorpus) {
    const corpus = normalize(ctx.userTextCorpus)
    const inCorpus = (name: string): boolean => {
      const ts = tokens(name)
      if (ts.length === 0) return false
      return ts.some(t => t.length >= 3 && corpus.includes(t))
    }
    if (!inCorpus(service_name)) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule REJECTED — hallucinated service="${service_name}" (no token in user corpus)`)
      return { success: false, result: 'Para agendar necesito el servicio. ¿Para qué servicio?' }
    }
    if (!inCorpus(client_name)) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule REJECTED — hallucinated client="${client_name}" (no token in user corpus)`)
      return { success: false, result: 'Para agendar necesito el nombre del cliente. ¿A quién agendo?' }
    }
    if (!userMentionedTime(ctx.userTextCorpus)) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule REJECTED — hallucinated time="${time}" (user never said a time)`)
      return { success: false, result: 'Para agendar necesito la hora. ¿A qué hora?' }
    }
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
    if (!parseDateExpression(ctx.userTextCorpus, todayLocal)) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule REJECTED — hallucinated date="${date}" (user never said a date)`)
      return { success: false, result: 'Para agendar necesito la fecha. ¿Para qué día?' }
    }
  }

  // 1. Resolve client (auto-create if not found)
  let client: ClientRow
  const resolution = await resolveClient(ctx, client_name)
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map(c => c.name).join(', ')
    return { success: false, result: `Hay varios clientes con nombre similar: ${names}. ¿Cuál es?` }
  }
  if (resolution.status === 'found') {
    client = resolution.client
  } else {
    const { data: created, error } = await ctx.supabase
      .from('clients')
      .insert({ business_id: ctx.businessId, name: client_name })
      .select('id, name, phone')
      .single()
    if (error || !created) {
      return { success: false, result: `No pude registrar a ${client_name}: ${error?.message ?? 'error desconocido'}` }
    }
    client = created as ClientRow
  }

  // 2. Resolve service
  const service = await resolveService(ctx, service_name)
  if (!service) {
    const all = await getActiveServices(ctx)
    const catalog = all.map(s => s.name).join(', ') || 'ninguno'
    return { success: false, result: `No encontré el servicio "${service_name}". Disponibles: ${catalog}.` }
  }

  // 3. Compute slot in UTC + check conflicts
  const startISO = localToUTC(date, time, ctx.timezone)
  const endISO   = buildEndISO(startISO, service.duration_min)
  if (await findConflicts(ctx, startISO, endISO)) {
    return { success: false, result: `El horario ${time} del ${date} ya está ocupado. Elige otra hora.` }
  }

  // 4. Insert appointment (trigger handles appointment_services junction)
  const { data: created, error } = await ctx.supabase
    .from('appointments')
    .insert({
      business_id: ctx.businessId,
      client_id:   client.id,
      service_id:  service.id,
      start_at:    startISO,
      end_at:      endISO,
      status:      'pending',
    })
    .select('id')
    .single()

  if (error || !created) {
    return { success: false, result: `No pude crear la cita: ${error?.message ?? 'error desconocido'}` }
  }

  const data: BookingEventData = {
    appointmentId: created.id as string,
    clientName:    client.name,
    serviceName:   service.name,
    date,
    time,
    action:        'created',
  }
  return {
    success: true,
    result:  `Listo. Agendé a ${client.name} para ${service.name} el ${date} a las ${time}.`,
    data,
  }
}

// ── Tool: cancel_booking ───────────────────────────────────────────────────

interface CancelBookingArgs {
  client_name: string
  date?:       string
  time?:       string
}

async function cancelBooking(ctx: ToolContext, args: CancelBookingArgs): Promise<ToolResult> {
  if (!args.client_name) return { success: false, result: 'Necesito el nombre del cliente para cancelar.' }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status !== 'found') {
    if (resolution.status === 'ambiguous') {
      const names = resolution.candidates.map(c => c.name).join(', ')
      return { success: false, result: `Hay varios clientes similares: ${names}. ¿Cuál?` }
    }
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  const apt = await findAppointmentByClientName(ctx, resolution.client, args.date, args.time)
  if ('error' in apt) return { success: false, result: apt.error }

  let serviceName = 'Servicio'
  const serviceId = resolveAppointmentServiceId(apt)
  if (serviceId) {
    const svc = await resolveService(ctx, serviceId)
    if (svc) serviceName = svc.name
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude cancelar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName:    resolution.client.name,
    serviceName,
    date: apt.start_at.slice(0, 10),
    time: apt.start_at.slice(11, 16),
    action: 'cancelled',
  }
  return {
    success: true,
    result:  `Listo. Cancelé la cita de ${resolution.client.name} (${serviceName}).`,
    data,
  }
}

// ── Tool: reschedule_booking ───────────────────────────────────────────────

interface RescheduleBookingArgs {
  client_name: string
  date?:       string
  time?:       string
  new_date:    string
  new_time:    string
}

async function rescheduleBooking(ctx: ToolContext, args: RescheduleBookingArgs): Promise<ToolResult> {
  if (!args.client_name || !args.new_date || !args.new_time) {
    return { success: false, result: 'Necesito el cliente y la nueva fecha/hora.' }
  }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status !== 'found') {
    if (resolution.status === 'ambiguous') {
      const names = resolution.candidates.map(c => c.name).join(', ')
      return { success: false, result: `Hay varios clientes similares: ${names}. ¿Cuál?` }
    }
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  const apt = await findAppointmentByClientName(ctx, resolution.client, args.date, args.time)
  if ('error' in apt) return { success: false, result: apt.error }

  let durationMin = 60
  let serviceName = 'Servicio'
  const serviceId = resolveAppointmentServiceId(apt)
  if (serviceId) {
    const svc = await resolveService(ctx, serviceId)
    if (svc) {
      durationMin = svc.duration_min
      serviceName = svc.name
    }
  }

  const newStartISO = localToUTC(args.new_date, args.new_time, ctx.timezone)
  const newEndISO   = buildEndISO(newStartISO, durationMin)

  if (await findConflicts(ctx, newStartISO, newEndISO, apt.id)) {
    return { success: false, result: `El horario ${args.new_time} del ${args.new_date} ya está ocupado. Elige otra hora.` }
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ start_at: newStartISO, end_at: newEndISO })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude reagendar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName:    resolution.client.name,
    serviceName,
    date: args.new_date,
    time: args.new_time,
    action: 'rescheduled',
  }
  return {
    success: true,
    result:  `Listo. Reagendé la cita de ${resolution.client.name} para el ${args.new_date} a las ${args.new_time}.`,
    data,
  }
}

// ── Tool: get_appointments_by_date ─────────────────────────────────────────

interface GetByDateArgs { date: string }

async function getAppointmentsByDate(ctx: ToolContext, args: GetByDateArgs): Promise<ToolResult> {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
  }

  const startISO = localToUTC(args.date, '00:00', ctx.timezone)
  const endISO   = localToUTC(args.date, '23:59', ctx.timezone)

  const { data, error } = await ctx.supabase
    .from('appointments')
    .select(`
      id,
      start_at,
      status,
      client:clients(name),
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .neq('status', 'cancelled')
    .gte('start_at', startISO)
    .lte('start_at', endISO)
    .order('start_at')

  console.log(`[VOICE-WORKER-TOOLS] get_appointments_by_date date=${args.date} tz=${ctx.timezone} range=[${startISO} → ${endISO}] found=${data?.length ?? 0}`)

  if (error) return { success: false, result: `Error al consultar citas: ${error.message}` }

  const dateLabel = humanizeDate(args.date, ctx.timezone)
  if (!data?.length) return { success: true, result: `No hay citas para el ${dateLabel}.` }

  type AptRow = {
    start_at: string
    client?:  { name?: string } | null
    service?: { name?: string } | null
    appointment_services?: Array<{
      sort_order: number
      service?:   { name?: string } | null
    }>
  }

  const items = (data as unknown as AptRow[]).map((row) => {
    const time = formatTimeFromISO(row.start_at, ctx.timezone)
    const cli  = row.client?.name ?? 'cliente'
    const junctionServices = (row.appointment_services ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
    const svc = row.service?.name
      ?? junctionServices[0]?.service?.name
      ?? 'servicio'
    return `${cli} a las ${time} para ${svc}`
  })

  const opener = data.length === 1
    ? `Tienes 1 cita el ${dateLabel}.`
    : `Tienes ${data.length} citas el ${dateLabel}.`

  return {
    success: true,
    result:  `${opener} ${items.join('. ')}.`,
  }
}

// ── Tool: search_clients ───────────────────────────────────────────────────

interface SearchClientsArgs { query: string }

async function searchClients(ctx: ToolContext, args: SearchClientsArgs): Promise<ToolResult> {
  if (!args.query || args.query.length < 2) {
    return { success: false, result: 'Necesito al menos 2 caracteres para buscar.' }
  }

  const all = await getActiveClients(ctx)
  if (!all.length) {
    return { success: true, result: `No tengo a ${args.query} entre tus clientes. Si lo agendas, queda registrado automáticamente.` }
  }

  const resolution = await resolveClient(ctx, args.query)

  if (resolution.status === 'found') {
    const m = resolution.client
    const phoneStr = m.phone ? `, su teléfono es ${m.phone}` : ', no tiene teléfono registrado'
    return { success: true, result: `Sí, ${m.name} está entre tus clientes${phoneStr}.` }
  }

  if (resolution.status === 'ambiguous') {
    const candidates = resolution.candidates
    const opener = `Tengo ${candidates.length} clientes con nombre similar a ${args.query}.`
    const items  = candidates
      .map(c => c.phone ? `${c.name}, teléfono ${c.phone}` : `${c.name}, sin teléfono registrado`)
      .join('. ')
    return { success: true, result: `${opener} ${items}. ¿A cuál te refieres?` }
  }

  return { success: true, result: `No tengo a ${args.query} entre tus clientes. Si lo agendas, queda registrado automáticamente.` }
}

// ── Tool: get_last_visit ───────────────────────────────────────────────────

interface GetLastVisitArgs { client_name: string }

interface LastVisitRow {
  id:        string
  start_at:  string
  status:    string
  service?:  { name?: string } | null
  appointment_services?: Array<{ sort_order: number; service?: { name?: string } | null }>
}

async function getLastVisit(ctx: ToolContext, args: GetLastVisitArgs): Promise<ToolResult> {
  if (!args.client_name) {
    return { success: false, result: 'Necesito el nombre del cliente.' }
  }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status === 'not_found') {
    return { success: true, result: `No tengo a ${args.client_name} entre tus clientes.` }
  }
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map(c => c.name).join(', ')
    return { success: true, result: `Hay varios clientes con nombre similar: ${names}. ¿A cuál te refieres?` }
  }
  const client = resolution.client

  const nowISO = new Date().toISOString()
  const { data, error } = await ctx.supabase
    .from('appointments')
    .select(`
      id,
      start_at,
      status,
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .eq('client_id', client.id)
    .lt('start_at', nowISO)
    .order('start_at', { ascending: false })
    .limit(1)

  if (error) return { success: false, result: `Error al consultar la última visita: ${error.message}` }
  if (!data?.length) {
    return { success: true, result: `${client.name} no tiene visitas anteriores registradas.` }
  }

  const apt = data[0] as unknown as LastVisitRow
  const isoDate = apt.start_at.slice(0, 10)
  const dateLabel = humanizeDate(isoDate, ctx.timezone)

  const junctionServices = (apt.appointment_services ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
  const serviceName = apt.service?.name
    ?? junctionServices[0]?.service?.name
    ?? ''

  const STATUS_PHRASE: Record<string, string> = {
    completed: 'asistió y completó el servicio',
    no_show:   'no asistió a la cita',
    cancelled: 'la cita fue cancelada',
    confirmed: 'la cita estaba confirmada',
    pending:   'la cita estaba pendiente',
  }
  const statusPhrase = STATUS_PHRASE[apt.status] ?? 'tuvo una cita'
  const svcPart = serviceName ? ` para ${serviceName}` : ''

  return {
    success: true,
    result: `La última cita de ${client.name} fue el ${dateLabel}${svcPart}. ${capitalize(statusPhrase)}.`,
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

// ── Tool: get_services ─────────────────────────────────────────────────────

async function getServices(ctx: ToolContext): Promise<ToolResult> {
  const all = await getActiveServices(ctx)
  if (!all.length) return { success: true, result: 'No hay servicios configurados.' }
  const lines = all.map(s => `${s.name} (${s.duration_min} min, $${s.price})`)
  return { success: true, result: `Servicios disponibles: ${lines.join(', ')}.` }
}

// ── Tool: create_client ────────────────────────────────────────────────────

interface CreateClientArgs { name: string; phone?: string }

async function createClient(ctx: ToolContext, args: CreateClientArgs): Promise<ToolResult> {
  if (!args.name) return { success: false, result: 'Necesito el nombre del cliente.' }

  const { data, error } = await ctx.supabase
    .from('clients')
    .insert({
      business_id: ctx.businessId,
      name:        args.name,
      phone:       args.phone ?? null,
    })
    .select('id, name')
    .single()

  if (error || !data) return { success: false, result: `No se pudo registrar: ${error?.message ?? 'desconocido'}` }
  return { success: true, result: `Cliente "${(data as { name: string }).name}" registrado.` }
}

// ── Tool: delete_client ────────────────────────────────────────────────────

interface DeleteClientArgs {
  client_name: string
  /** Phone disambiguator when multiple clients share a name. */
  phone?: string
  /**
   * True when the user has given explicit consent to remove any one of the
   * duplicates ("elimina a cualquiera", "borra los duplicados").
   */
  any_duplicate?: boolean
}

async function deleteClient(ctx: ToolContext, args: DeleteClientArgs): Promise<ToolResult> {
  if (!args.client_name) return { success: false, result: 'Necesito el nombre del cliente.' }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status === 'not_found') {
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  let target: ClientRow
  if (resolution.status === 'found') {
    target = resolution.client
  } else {
    const candidates = resolution.candidates
    const wantedPhone = normalisePhone(args.phone)

    if (!wantedPhone) {
      const phones = candidates.map(c => normalisePhone(c.phone))
      const allSame = phones.every(p => p === phones[0])
      if (allSame) {
        if (args.any_duplicate) {
          target = candidates[0]!
        } else {
          const phoneStr = phones[0] ? `con el mismo teléfono ${candidates[0]!.phone}` : 'sin teléfono registrado'
          return {
            success: false,
            result: `Tengo ${candidates.length} clientes llamados ${candidates[0]!.name} ${phoneStr} — parecen duplicados. ¿Elimino uno y dejo el otro?`,
          }
        }
      } else {
        const list = candidates
          .map(c => c.phone ? `${c.name} con teléfono ${c.phone}` : `${c.name} sin teléfono`)
          .join(', ')
        return { success: false, result: `Hay varios clientes llamados ${candidates[0]!.name}: ${list}. ¿Cuál elimino, dime el teléfono?` }
      }
    } else {
      const matches = candidates.filter(c => normalisePhone(c.phone) === wantedPhone)
      if (matches.length === 0) {
        return { success: false, result: `No encontré a ${args.client_name} con el teléfono ${args.phone}.` }
      }
      target = matches[0]!
    }
  }

  const { count } = await ctx.supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .eq('client_id', target.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())

  if ((count ?? 0) > 0) {
    return { success: false, result: `No se puede eliminar: ${target.name} tiene ${count} cita(s) futura(s). Cancélalas primero.` }
  }

  const { error } = await ctx.supabase
    .from('clients')
    .delete()
    .eq('id', target.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude eliminar: ${error.message}` }
  const phoneSuffix = target.phone ? ` (teléfono ${target.phone})` : ''
  return { success: true, result: `Cliente ${target.name}${phoneSuffix} eliminado.` }
}

// ── Tool: get_available_slots ──────────────────────────────────────────────

interface GetAvailableSlotsArgs { date: string; duration_min: number }

async function getAvailableSlots(ctx: ToolContext, args: GetAvailableSlotsArgs): Promise<ToolResult> {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
  }
  if (!args.duration_min || args.duration_min < 5 || args.duration_min > 480) {
    return { success: false, result: 'Necesito una duración entre 5 y 480 minutos.' }
  }

  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', timeZone: ctx.timezone,
  }).format(new Date(`${args.date}T12:00:00Z`)).toLowerCase()

  const wh = ctx.workingHours?.[dayOfWeek]
  if (ctx.workingHours && Object.prototype.hasOwnProperty.call(ctx.workingHours, dayOfWeek) && !wh) {
    return { success: true, result: `El negocio está cerrado el ${args.date}.` }
  }

  const open  = wh?.open  ?? '09:00'
  const close = wh?.close ?? '18:00'

  const { data: booked, error } = await ctx.supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', `${args.date}T00:00:00`)
    .lte('start_at', `${args.date}T23:59:59`)
    .order('start_at')

  if (error) return { success: false, result: `Error al consultar disponibilidad: ${error.message}` }

  const SLOT_INTERVAL = 30
  const free: string[] = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)

  for (let h = oh!; h < ch!; h++) {
    for (let m = (h === oh ? om! : 0); m < 60; m += SLOT_INTERVAL) {
      if (h === ch && m >= cm!) break
      const candidateTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const startISO = localToUTC(args.date, candidateTime, ctx.timezone)
      const endISO   = buildEndISO(startISO, args.duration_min)
      const conflict = (booked ?? []).some((b: { start_at: string; end_at: string }) =>
        new Date(b.start_at) < new Date(endISO) && new Date(b.end_at) > new Date(startISO)
      )
      if (!conflict) free.push(candidateTime)
    }
  }

  if (!free.length) return { success: true, result: `No hay horarios libres para el ${args.date}.` }
  return { success: true, result: `Horarios libres el ${args.date}: ${free.join(', ')}.` }
}

// ── Dispatcher + tool definitions for the LLM ──────────────────────────────

export interface ToolDefinition {
  type: 'function'
  function: {
    name:        string
    description: string
    parameters:  Record<string, unknown>
  }
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'smart_schedule',
      description: 'Agenda una cita en un solo paso. Llama SOLO cuando tengas servicio + cliente + fecha + hora.',
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Nombre del servicio' },
          client_name:  { type: 'string', description: 'Nombre del cliente' },
          date:         { type: 'string', description: 'YYYY-MM-DD' },
          time:         { type: 'string', description: 'HH:mm 24h' },
        },
        required: ['service_name', 'client_name', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Cancela una cita. Pasa client_name; date/time opcionales para desambiguar.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          date:        { type: 'string', description: 'YYYY-MM-DD opcional' },
          time:        { type: 'string', description: 'HH:mm opcional' },
        },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_booking',
      description: 'Reagenda una cita a una nueva fecha/hora.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          date:        { type: 'string', description: 'YYYY-MM-DD actual (opcional)' },
          time:        { type: 'string', description: 'HH:mm actual (opcional)' },
          new_date:    { type: 'string', description: 'YYYY-MM-DD nuevo' },
          new_time:    { type: 'string', description: 'HH:mm nuevo' },
        },
        required: ['client_name', 'new_date', 'new_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_appointments_by_date',
      description: 'Lista citas de un día específico.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Busca un cliente por nombre. Devuelve nombre y teléfono.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Mínimo 2 caracteres' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_last_visit',
      description: 'Devuelve la última cita pasada de un cliente: fecha, servicio y si asistió, no asistió o fue cancelada.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre del cliente' } },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_services',
      description: 'Lista los servicios del negocio.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_client',
      description: 'Registra un cliente nuevo (cuando el usuario pida explícitamente registrar).',
      parameters: {
        type: 'object',
        properties: {
          name:  { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_client',
      description: 'Elimina un cliente. Pasa phone cuando dos clientes compartan el nombre. Pasa any_duplicate=true cuando el usuario diga "elimina a cualquiera" / "borra los duplicados" / "elimina uno". Falla si tiene citas futuras.',
      parameters: {
        type: 'object',
        properties: {
          client_name:   { type: 'string' },
          phone:         { type: 'string',  description: 'Teléfono para desambiguar entre clientes con el mismo nombre' },
          any_duplicate: { type: 'boolean', description: 'true cuando el usuario consintió borrar uno de los duplicados sin importar cuál' },
        },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Consulta horarios libres para una fecha y duración.',
      parameters: {
        type: 'object',
        properties: {
          date:         { type: 'string', description: 'YYYY-MM-DD' },
          duration_min: { type: 'number', description: '5-480' },
        },
        required: ['date', 'duration_min'],
      },
    },
  },
]

export const WRITE_TOOLS = new Set([
  'smart_schedule', 'cancel_booking', 'reschedule_booking',
  'create_client', 'delete_client',
])

/** Single dispatcher — agent.ts only needs to know this. */
export async function executeTool(
  toolName: string,
  args:     Record<string, unknown>,
  ctx:      ToolContext,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'smart_schedule':           return await smartSchedule(ctx, args as unknown as SmartScheduleArgs)
      case 'cancel_booking':           return await cancelBooking(ctx, args as unknown as CancelBookingArgs)
      case 'reschedule_booking':       return await rescheduleBooking(ctx, args as unknown as RescheduleBookingArgs)
      case 'get_appointments_by_date': return await getAppointmentsByDate(ctx, args as unknown as GetByDateArgs)
      case 'search_clients':           return await searchClients(ctx, args as unknown as SearchClientsArgs)
      case 'get_last_visit':           return await getLastVisit(ctx, args as unknown as GetLastVisitArgs)
      case 'get_services':             return await getServices(ctx)
      case 'create_client':            return await createClient(ctx, args as unknown as CreateClientArgs)
      case 'delete_client':            return await deleteClient(ctx, args as unknown as DeleteClientArgs)
      case 'get_available_slots':      return await getAvailableSlots(ctx, args as unknown as GetAvailableSlotsArgs)
      default:
        return { success: false, result: `Tool desconocida: ${toolName}`, error: 'TOOL_NOT_FOUND' }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[VOICE-WORKER-TOOLS] ${toolName} threw: ${msg}`)
    return { success: false, result: 'Error interno al ejecutar la acción.', error: msg }
  }
}
