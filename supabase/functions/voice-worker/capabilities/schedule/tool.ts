/**
 * smart_schedule — single-shot booking.
 *
 * Two callers:
 *   - Fast path (registry): all four params already pulled from user text.
 *   - LLM path: Llama emitted a tool_call. The corpus guards below validate
 *     each param traces back to something the user actually said this turn,
 *     and the date/time overrides repair the model's habitual drift toward
 *     09:00 / today.
 *
 * No silent auto-create: STT mishears Spanish names ("Lizeth" → "Licey"), and
 * the fuzzy resolver correctly refuses to bridge them. The previous branch
 * that auto-inserted unknown names left duplicates in the DB.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult, BookingEventData } from '../../types.ts'
import { localToUTC, buildEndISO } from '../../core/time-format.ts'
import { normalize, tokens }       from '../../core/fuzzy.ts'
import { parseDateExpression }     from '../../core/date-parser.ts'
import { parseTimeExpression, userMentionedTime } from '../../core/time-parser.ts'
import {
  type ClientRow, resolveClient, needsConfirmation, formatConfirmationPrompt,
} from '../../core/repos/clients.ts'
import { getActiveServices, resolveService } from '../../core/repos/services.ts'
import { findConflicts } from '../../core/repos/appointments.ts'

export interface ScheduleArgs extends Record<string, unknown> {
  service_name:         string
  client_name:          string
  date:                 string
  time:                 string
  register_new_client?: boolean
}

const SCHEDULE_PLACEHOLDER = /^(?:\?+|tbd|pendiente|por\s+definir|n\/a|none|null|undefined|sin\s+(?:especificar|definir)|no\s+especificad[oa])$/i

function isMissing(value: string | undefined): boolean {
  if (!value) return true
  const t = value.trim()
  if (t.length === 0) return true
  return SCHEDULE_PLACEHOLDER.test(t)
}

function firstMissing(args: ScheduleArgs): string | null {
  if (isMissing(args.client_name))  return 'el nombre del cliente'
  if (isMissing(args.service_name)) return 'el servicio'
  if (isMissing(args.date))         return 'la fecha'
  if (isMissing(args.time))         return 'la hora'
  return null
}

export async function executeSchedule(
  ctx:  ToolContext,
  args: ScheduleArgs,
): Promise<ToolResult> {
  let { service_name, client_name, date, time } = args

  if (ctx.userTextCorpus) {
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
    const userDate = parseDateExpression(ctx.userTextCorpus, todayLocal)?.date
    const userTime = parseTimeExpression(ctx.userTextCorpus)?.time
    if (userDate && userDate !== date) {
      console.log(`[VOICE-WORKER-SCHEDULE] date override: arg="${date}" → user="${userDate}"`)
      date = userDate
    }
    if (userTime && userTime !== time) {
      console.log(`[VOICE-WORKER-SCHEDULE] time override: arg="${time}" → user="${userTime}"`)
      time = userTime
    }
  }

  const missingLabel = firstMissing({ ...args, client_name, service_name, date, time })
  if (missingLabel) {
    return { success: false, result: `Para agendar necesito ${missingLabel}. ¿Me lo dices?` }
  }

  if (ctx.userTextCorpus) {
    const corpus = normalize(ctx.userTextCorpus)
    const inCorpus = (name: string): boolean => {
      const ts = tokens(name)
      if (ts.length === 0) return false
      return ts.some(t => t.length >= 3 && corpus.includes(t))
    }
    if (!inCorpus(service_name)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated service="${service_name}"`)
      return { success: false, result: 'Para agendar necesito el servicio. ¿Para qué servicio?' }
    }
    if (!inCorpus(client_name)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated client="${client_name}"`)
      return { success: false, result: 'Para agendar necesito el nombre del cliente. ¿A quién agendo?' }
    }
    if (!userMentionedTime(ctx.userTextCorpus)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated time="${time}"`)
      return { success: false, result: 'Para agendar necesito la hora. ¿A qué hora?' }
    }
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
    if (!parseDateExpression(ctx.userTextCorpus, todayLocal)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated date="${date}"`)
      return { success: false, result: 'Para agendar necesito la fecha. ¿Para qué día?' }
    }
  }

  const resolution = await resolveClient(ctx, client_name)
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map(c => c.name).join(', ')
    return { success: false, result: `Hay varios clientes con nombre similar: ${names}. ¿Cuál es?` }
  }
  let client: ClientRow
  if (resolution.status === 'found') {
    if (needsConfirmation(resolution)) {
      return { success: false, result: formatConfirmationPrompt(resolution, client_name) }
    }
    client = resolution.client
  } else if (args.register_new_client) {
    const { data: created, error } = await ctx.supabase
      .from('clients')
      .insert({ business_id: ctx.businessId, name: client_name })
      .select('id, name, phone')
      .single()
    if (error || !created) {
      return { success: false, result: `No pude registrar a ${client_name}: ${error?.message ?? 'error desconocido'}` }
    }
    client = created as ClientRow
  } else {
    return {
      success: false,
      result:  `No tengo a ${client_name} entre tus clientes. ¿Quieres que lo registre como cliente nuevo y luego agende?`,
    }
  }

  const service = await resolveService(ctx, service_name)
  if (!service) {
    const all = await getActiveServices(ctx)
    const catalog = all.map(s => s.name).join(', ') || 'ninguno'
    return { success: false, result: `No encontré el servicio "${service_name}". Disponibles: ${catalog}.` }
  }

  const startISO = localToUTC(date, time, ctx.timezone)
  const endISO   = buildEndISO(startISO, service.duration_min)
  if (await findConflicts(ctx, startISO, endISO)) {
    return { success: false, result: `El horario ${time} del ${date} ya está ocupado. Elige otra hora.` }
  }

  if (ctx.runWriteGuard) {
    const denied = await ctx.runWriteGuard('book_appointment', {
      clientId:    client.id,
      clientName:  client.name,
      serviceId:   service.id,
      serviceName: service.name,
      date,
      time,
    })
    if (denied) return denied
  }

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
