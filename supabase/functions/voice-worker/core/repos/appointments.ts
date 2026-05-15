import type { ToolContext } from '../tool-context.ts'
import type { ClientRow }   from './clients.ts'
import { localToUTC, formatTimeFromISO } from '../time-format.ts'

export interface AppointmentForLookup {
  id:         string
  start_at:   string
  end_at:     string
  client_id:  string | null
  service_id: string | null
  /** Service IDs from the junction table — used as fallback when service_id is null. */
  appointment_services?: Array<{ service_id: string; sort_order: number }>
}

export async function findConflicts(
  ctx:       ToolContext,
  startISO:  string,
  endISO:    string,
  excludeId?: string,
): Promise<boolean> {
  let q = ctx.supabase
    .from('appointments')
    .select('id')
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .lt('start_at', endISO)
    .gt('end_at', startISO)
  if (excludeId) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) return false  // fail-open: assume no conflict, let DB handle
  return (data?.length ?? 0) > 0
}

/**
 * Looks up an appointment by ID (and business) — used by anaphoric
 * reschedule/cancel which already know the exact appointment from the
 * lastRef. Skips the date-based search entirely, sidestepping the
 * "search today" fallback that misfires on appointments scheduled for
 * any other day.
 */
export async function findAppointmentById(
  ctx: ToolContext,
  id:  string,
): Promise<AppointmentForLookup | { error: string }> {
  const { data, error } = await ctx.supabase
    .from('appointments')
    .select('id, start_at, end_at, client_id, service_id, appointment_services(service_id, sort_order), status')
    .eq('business_id', ctx.businessId)
    .eq('id', id)
    .single()
  if (error || !data) return { error: 'La cita no existe o ya fue eliminada.' }
  // Reject if the appointment is already cancelled — anaphoric "cancélala"
  // on a cancelled appointment would otherwise look like success.
  const row = data as AppointmentForLookup & { status?: string }
  if (row.status === 'cancelled') return { error: 'Esa cita ya estaba cancelada.' }
  return row
}

/**
 * Two query modes:
 *
 *  - When `date` is given, look at that single day only (the user named a
 *    specific date, so a miss on that day is genuinely "no encontré").
 *  - When `date` is NOT given, scan ALL upcoming active appointments for
 *    this client from today onward and return the next one. The previous
 *    "default to today" behaviour caused "cancela la cita de Gardi" to
 *    fail whenever Gardi's appointment was scheduled for any day other
 *    than today — which is the common case.
 *
 * Multiple candidates on the same day → time disambiguator when supplied,
 * otherwise an ambiguity error listing the times. Multiple candidates
 * across different days → list the dates and ask which one to act on.
 */
export async function findAppointmentByClientName(
  ctx:    ToolContext,
  client: ClientRow,
  date?:  string,
  time?:  string,
): Promise<AppointmentForLookup | { error: string }> {
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
  const startISO   = localToUTC(date ?? todayLocal, '00:00', ctx.timezone)
  const endISO     = date
    ? localToUTC(date, '23:59', ctx.timezone)
    : localToUTC(addDaysIso(todayLocal, 365), '23:59', ctx.timezone)   // open future window

  const { data, error } = await ctx.supabase
    .from('appointments')
    .select('id, start_at, end_at, client_id, service_id, appointment_services(service_id, sort_order)')
    .eq('business_id', ctx.businessId)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', startISO)
    .lte('start_at', endISO)
    .order('start_at')

  if (error) return { error: `Error buscando cita: ${error.message}` }
  const list = (data ?? []) as unknown as AppointmentForLookup[]

  if (list.length === 0) {
    return date
      ? { error: `No encontré cita activa de ${client.name} el ${date}.` }
      : { error: `${client.name} no tiene citas activas próximas.` }
  }
  if (list.length === 1) return list[0]!

  // Disambiguation: prefer time match within a single day; otherwise enumerate.
  if (time) {
    const matched = list.find(a => formatTimeFromISO(a.start_at, ctx.timezone).startsWith(time.split(':')[0]!))
    if (matched) return matched
  }

  const sameDay = list.every(a => a.start_at.slice(0, 10) === list[0]!.start_at.slice(0, 10))
  if (sameDay) {
    const labels = list.slice(0, 3).map(a => formatTimeFromISO(a.start_at, ctx.timezone)).join(', ')
    return { error: `${client.name} tiene varias citas el ${list[0]!.start_at.slice(0, 10)}: ${labels}. ¿Cuál?` }
  }
  const labels = list.slice(0, 3).map(a => a.start_at.slice(0, 10)).join(', ')
  return { error: `${client.name} tiene varias citas próximas: ${labels}. ¿Cuál fecha?` }
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  date.setUTCDate(date.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Resolves the canonical service_id for an appointment, checking the direct FK
 * first and falling back to the lowest-sort-order entry in the junction table.
 */
export function resolveAppointmentServiceId(apt: AppointmentForLookup): string | null {
  if (apt.service_id) return apt.service_id
  const sorted = (apt.appointment_services ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
  return sorted[0]?.service_id ?? null
}
