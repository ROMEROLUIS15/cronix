/**
 * get_last_visit — returns the client's most recent past appointment with
 * its date, service, and attendance status. Selects both the direct FK on
 * appointments and the appointment_services junction so rows that store the
 * service only via the junction still render correctly.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { resolveClient } from '../../core/repos/clients.ts'
import { humanizeDate }  from '../../core/time-format.ts'

export interface LastVisitArgs extends Record<string, unknown> {
  client_name: string
}

interface LastVisitRow {
  id:        string
  start_at:  string
  status:    string
  service?:  { name?: string } | null
  appointment_services?: Array<{ sort_order: number; service?: { name?: string } | null }>
}

const STATUS_PHRASE: Record<string, string> = {
  completed: 'asistió y completó el servicio',
  no_show:   'no asistió a la cita',
  cancelled: 'la cita fue cancelada',
  confirmed: 'la cita estaba confirmada',
  pending:   'la cita estaba pendiente',
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

export async function executeLastVisit(
  ctx:  ToolContext,
  args: LastVisitArgs,
): Promise<ToolResult> {
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
      id, start_at, status,
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

  const statusPhrase = STATUS_PHRASE[apt.status] ?? 'tuvo una cita'
  const svcPart = serviceName ? ` para ${serviceName}` : ''

  return {
    success: true,
    result: `La última cita de ${client.name} fue el ${dateLabel}${svcPart}. ${capitalize(statusPhrase)}.`,
  }
}
