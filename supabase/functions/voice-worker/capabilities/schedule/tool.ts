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
import {
  extractSlotsFromCorpus,
  nameMentionedInCorpus,
  timeMentionedInCorpus,
  dateMentionedInCorpus,
} from '../../core/conversation/slot-extractor.ts'
import {
  type ClientRow, resolveClient, needsConfirmation, formatConfirmationPrompt, normalisePhone,
} from '../../core/repos/clients.ts'
import { getActiveServices, resolveService } from '../../core/repos/services.ts'
import { findConflicts } from '../../core/repos/appointments.ts'

export interface ScheduleArgs extends Record<string, unknown> {
  service_name:         string
  client_name:          string
  date:                 string
  time:                 string
  register_new_client?: boolean
  /** Phone for the NEW client when register_new_client=true. Previously the
   *  tool had no phone arg at all, so a number the user dictated during the
   *  booking was silently discarded and the client landed phone-less. */
  phone?:               string
}

/**
 * Returns the phone to store for a newly registered client, or null. The
 * digits must trace back to the user corpus (same anti-hallucination rule as
 * names): an LLM-invented number is worse than no number. Empty corpus ⇒
 * fail-open, mirroring the other guards.
 */
function verifiedPhone(rawPhone: unknown, corpus: string): string | null {
  if (typeof rawPhone !== 'string' || !rawPhone.trim()) return null
  const digits = normalisePhone(rawPhone)
  if (digits.length < 7) return null
  if (!corpus) return rawPhone.trim()
  return corpus.replace(/\D+/g, '').includes(digits) ? rawPhone.trim() : null
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
  const corpus     = ctx.userTextCorpus ?? ''
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })

  // Step 1 — recover slots the LLM dropped across turns.
  if (corpus) {
    const fromCorpus = extractSlotsFromCorpus(corpus, todayLocal)
    if (fromCorpus.date && fromCorpus.date !== date) {
      console.log(`[VOICE-WORKER-SCHEDULE] date override: arg="${date}" → user="${fromCorpus.date}"`)
      date = fromCorpus.date
    }
    if (fromCorpus.time && fromCorpus.time !== time) {
      console.log(`[VOICE-WORKER-SCHEDULE] time override: arg="${time}" → user="${fromCorpus.time}"`)
      time = fromCorpus.time
    }
  }

  // Step 2 — refuse if any of the 4 slots is still missing or a placeholder.
  const missingLabel = firstMissing({ ...args, client_name, service_name, date, time })
  if (missingLabel) {
    return { success: false, result: `Para agendar necesito ${missingLabel}. ¿Me lo dices?` }
  }

  // Step 3 — anti-hallucination: every slot must trace back to the user.
  if (corpus) {
    if (!nameMentionedInCorpus(corpus, service_name)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated service="${service_name}"`)
      return { success: false, result: 'Para agendar necesito el servicio. ¿Para qué servicio?', error: 'GUARD_REJECTED' }
    }
    if (!nameMentionedInCorpus(corpus, client_name)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated client="${client_name}"`)
      return { success: false, result: 'Para agendar necesito el nombre del cliente. ¿A quién agendo?', error: 'GUARD_REJECTED' }
    }
    if (!timeMentionedInCorpus(corpus)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated time="${time}"`)
      return { success: false, result: 'Para agendar necesito la hora. ¿A qué hora?', error: 'GUARD_REJECTED' }
    }
    if (!dateMentionedInCorpus(corpus, todayLocal)) {
      console.log(`[VOICE-WORKER-SCHEDULE] REJECTED — hallucinated date="${date}"`)
      return { success: false, result: 'Para agendar necesito la fecha. ¿Para qué día?', error: 'GUARD_REJECTED' }
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
      .insert({ business_id: ctx.businessId, name: client_name, phone: verifiedPhone(args.phone, corpus) })
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
