/**
 * get_last_visit — returns the client's most recent *attended* past
 * appointment with its date and service. By definition, a cancelled or
 * no-show appointment is not a "visit" — the client didn't actually
 * come in. We filter those out at the DB layer and only consider
 * statuses where the client was (or was expected to be) present:
 *
 *   - completed  → asistió y se cerró el servicio
 *   - confirmed  → confirmada (en muchos negocios queda así tras la visita)
 *   - pending    → quedó como pendiente (presencia probable, sin cierre formal)
 *
 * Hard exclusions: cancelled, no_show. If all of the client's history is
 * cancelled / no-show, we say so explicitly instead of pretending the
 * cancellation was the "last visit".
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { resolveClient, needsConfirmation, formatConfirmationPrompt } from '../../core/repos/clients.ts'
import { humanizeDate }  from '../../core/time-format.ts'
import { nameMentionedInCorpus } from '../../core/conversation/slot-extractor.ts'

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

/** Statuses we treat as "the client actually visited". */
const ATTENDED_STATUSES = ['completed', 'confirmed', 'pending'] as const

const STATUS_PHRASE: Record<string, string> = {
  completed: 'asistió y completó el servicio',
  confirmed: 'la cita quedó confirmada',
  pending:   'la cita quedó pendiente de cierre',
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

  // Anti-substitution guard. The LLM must not approximate a registered name the
  // user never said: when the spoken name ("Gardiana") isn't in the roster the
  // model otherwise passes the nearest registered one ("Adriana") and we'd
  // answer about the wrong person. nameMentionedInCorpus tolerates STT/phonetic
  // variants of what the user DID say but rejects fabrications. Fast-path names
  // come from the user text so they pass; empty corpus ⇒ fail-open (mirrors
  // smart_schedule's client_name guard).
  const corpus = ctx.userTextCorpus ?? ''
  if (corpus && !nameMentionedInCorpus(corpus, args.client_name)) {
    console.log(`[VOICE-WORKER-LAST-VISIT] REJECTED — hallucinated client="${args.client_name}"`)
    return { success: false, result: 'No te entendí bien el nombre. ¿De qué cliente quieres la última visita?', error: 'GUARD_REJECTED' }
  }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status === 'not_found') {
    return { success: true, result: `No tengo a ${args.client_name} entre tus clientes.` }
  }
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map(c => c.name).join(', ')
    return { success: true, result: `Hay varios clientes con nombre similar: ${names}. ¿A cuál te refieres?` }
  }

  // Weak single match → confirm the person before reading back their history.
  // last-visit is a READ but it exposes ONE named person's record, so a wrong
  // resolution is a real correctness/privacy miss. We gate on the SAME write
  // confidence bar (<0.80): exact/phonetic/vowel-class token hits floor at 0.90
  // (see fuzzy.ts), so a clearly-named client never trips this — only genuinely
  // weak similarity/prefix matches do. The prompt is a deterministic string on a
  // bypassLLM capability: it costs no LLM tokens, just a one-word reply turn.
  if (needsConfirmation(resolution)) {
    return { success: true, result: formatConfirmationPrompt(resolution, args.client_name) }
  }
  const client = resolution.client

  const nowISO = new Date().toISOString()
  // Only attended statuses count as "última visita". Cancelled / no_show
  // appointments mean the client never came in — they cannot be the answer.
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
    .in('status', ATTENDED_STATUSES as unknown as string[])
    .order('start_at', { ascending: false })
    .limit(1)

  if (error) return { success: false, result: `Error al consultar la última visita: ${error.message}` }
  if (!data?.length) {
    // Distinguish "no past appointments at all" from "all past were cancelled".
    // A second cheap query tells us which message to use without breaking the
    // hot path for clients that just have no history.
    const { count: anyPastCount } = await ctx.supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', ctx.businessId)
      .eq('client_id', client.id)
      .lt('start_at', nowISO)
    if ((anyPastCount ?? 0) > 0) {
      return { success: true, result: `${client.name} no tiene visitas asistidas: todas sus citas pasadas fueron canceladas o no asistió.` }
    }
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

  const statusPhrase = STATUS_PHRASE[apt.status] ?? 'asistió a su cita'
  const svcPart = serviceName ? ` para ${serviceName}` : ''

  return {
    success: true,
    result: `La última visita asistida de ${client.name} fue el ${dateLabel}${svcPart}. ${capitalize(statusPhrase)}.`,
  }
}
