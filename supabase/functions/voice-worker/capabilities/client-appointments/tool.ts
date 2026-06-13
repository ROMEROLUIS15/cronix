/**
 * get_client_appointments — lists a specific client's upcoming active
 * appointments (pending/confirmed, strictly future, max 5). The READ
 * counterpart of cancel/reschedule's internal lookup: before this tool
 * existed, "¿qué citas tiene Ana?" had no capability and the LLM answered
 * from the prompt's 5-row "CITAS DE HOY" excerpt or invented.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { resolveClient } from '../../core/repos/clients.ts'
import { humanizeDate, formatTimeFromISO, utcToLocalParts } from '../../core/time-format.ts'
import { nameMentionedInCorpus } from '../../core/conversation/slot-extractor.ts'

export interface ClientAppointmentsArgs extends Record<string, unknown> {
  client_name: string
}

interface UpcomingRow {
  start_at: string
  service?: { name?: string } | null
  appointment_services?: Array<{ sort_order: number; service?: { name?: string } | null }>
}

const MAX_LISTED = 5

export async function executeClientAppointments(
  ctx:  ToolContext,
  args: ClientAppointmentsArgs,
): Promise<ToolResult> {
  if (!args.client_name) {
    return { success: false, result: 'Necesito el nombre del cliente.' }
  }

  // Anti-substitution guard — same rationale as last_visit: don't answer
  // about a registered client the user never named. Empty corpus ⇒ fail-open.
  const corpus = ctx.userTextCorpus ?? ''
  if (corpus && !nameMentionedInCorpus(corpus, args.client_name)) {
    console.log(`[VOICE-WORKER-CLIENT-APPTS] REJECTED — hallucinated client="${args.client_name}"`)
    return { success: false, result: 'No te entendí bien el nombre. ¿De qué cliente quieres las citas?', error: 'GUARD_REJECTED' }
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
      start_at,
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gt('start_at', nowISO)
    .order('start_at', { ascending: true })
    .limit(MAX_LISTED)

  if (error) {
    return { success: false, result: `Error al consultar las citas de ${client.name}: ${error.message}` }
  }
  if (!data?.length) {
    return { success: true, result: `${client.name} no tiene citas próximas.` }
  }

  const items = (data as unknown as UpcomingRow[]).map(row => {
    // start_at is UTC — convert to the business-local day before labelling,
    // otherwise late-evening appointments shift to the next day's label.
    const { date: localDate } = utcToLocalParts(row.start_at, ctx.timezone)
    const dateLabel = humanizeDate(localDate, ctx.timezone)
    const time      = formatTimeFromISO(row.start_at, ctx.timezone)
    const junction  = (row.appointment_services ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
    const svc = row.service?.name ?? junction[0]?.service?.name ?? 'servicio'
    return `el ${dateLabel} a las ${time} para ${svc}`
  })

  const opener = items.length === 1
    ? `${client.name} tiene 1 cita próxima:`
    : `${client.name} tiene ${items.length} citas próximas:`

  return { success: true, result: `${opener} ${items.join('. ')}.` }
}
