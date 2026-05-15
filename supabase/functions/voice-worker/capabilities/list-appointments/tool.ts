/**
 * get_appointments_by_date — lists the appointments scheduled for a single
 * day in the business timezone. Returns user-facing prose: the agent uses
 * this directly as the spoken response (bypass LLM synthesis).
 *
 * Selects BOTH `service:services` (direct FK on appointments.service_id) AND
 * `appointment_services` (junction table). Some appointments store the
 * service only via the junction; querying just the direct FK left the
 * service name empty for those rows.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { localToUTC, humanizeDate, formatTimeFromISO } from '../../core/time-format.ts'

export interface ListAppointmentsArgs extends Record<string, unknown> {
  date: string
}

interface AptRow {
  start_at: string
  client?:  { name?: string } | null
  service?: { name?: string } | null
  appointment_services?: Array<{
    sort_order: number
    service?:   { name?: string } | null
  }>
}

export async function executeListAppointments(
  ctx:  ToolContext,
  args: ListAppointmentsArgs,
): Promise<ToolResult> {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
  }

  const startISO = localToUTC(args.date, '00:00', ctx.timezone)
  const endISO   = localToUTC(args.date, '23:59', ctx.timezone)

  const { data, error } = await ctx.supabase
    .from('appointments')
    .select(`
      id, start_at, status,
      client:clients(name),
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .neq('status', 'cancelled')
    .gte('start_at', startISO)
    .lte('start_at', endISO)
    .order('start_at')

  console.log(`[VOICE-WORKER-LIST-APPTS] date=${args.date} tz=${ctx.timezone} found=${data?.length ?? 0}`)
  if (error) return { success: false, result: `Error al consultar citas: ${error.message}` }

  const dateLabel = humanizeDate(args.date, ctx.timezone)
  if (!data?.length) return { success: true, result: `No hay citas para el ${dateLabel}.` }

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

  return { success: true, result: `${opener} ${items.join('. ')}.` }
}
