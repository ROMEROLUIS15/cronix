/**
 * get_next_appointment — first upcoming appointment after the current
 * instant, in the business timezone. Filters by `start_at > now()` so a
 * 12:00 AM appointment of today is NOT the "next" one when the user asks
 * at 1:54 PM. Works identically for owners and employees in any tz —
 * "next" is always relative to the user's `ctx.timezone`.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { humanizeDate, formatTimeFromISO } from '../../core/time-format.ts'

export type NextAppointmentArgs = Record<string, unknown>

interface NextApptRow {
  start_at: string
  client?:  { name?: string } | null
  service?: { name?: string } | null
  appointment_services?: Array<{
    sort_order: number
    service?:   { name?: string } | null
  }>
}

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function localDayName(iso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      weekday: 'short', timeZone: timezone,
    }).formatToParts(new Date(iso))
    const tag = parts.find(p => p.type === 'weekday')?.value ?? ''
    const map: Record<string, string> = {
      Sun: 'domingo', Mon: 'lunes', Tue: 'martes', Wed: 'miércoles',
      Thu: 'jueves', Fri: 'viernes', Sat: 'sábado',
    }
    return map[tag] ?? DAY_NAMES_ES[new Date(iso).getDay()] ?? ''
  } catch {
    return ''
  }
}

function localDateString(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export async function executeNextAppointment(
  ctx:  ToolContext,
  _args: NextAppointmentArgs,
): Promise<ToolResult> {
  const nowISO = new Date().toISOString()

  const { data, error } = await ctx.supabase
    .from('appointments')
    .select(`
      start_at,
      client:clients(name),
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .gt('start_at', nowISO)
    .order('start_at', { ascending: true })
    .limit(1)

  if (error) {
    return { success: false, result: `Error al consultar tu próxima cita: ${error.message}` }
  }
  if (!data?.length) {
    return { success: true, result: 'No tienes citas próximas programadas.' }
  }

  const row  = data[0] as unknown as NextApptRow
  const time = formatTimeFromISO(row.start_at, ctx.timezone)
  const cli  = row.client?.name ?? 'cliente'
  const junctionServices = (row.appointment_services ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
  const svc = row.service?.name
    ?? junctionServices[0]?.service?.name
    ?? 'servicio'

  const today    = localDateString(nowISO, ctx.timezone)
  const apptDate = localDateString(row.start_at, ctx.timezone)
  let whenLabel: string
  if (apptDate === today) {
    whenLabel = `hoy a las ${time}`
  } else {
    const day      = localDayName(row.start_at, ctx.timezone)
    const humanDay = humanizeDate(apptDate, ctx.timezone)
    whenLabel = `el ${day} ${humanDay} a las ${time}`
  }

  return {
    success: true,
    result: `Tu próxima cita es ${whenLabel} con ${cli} para ${svc}.`,
  }
}
