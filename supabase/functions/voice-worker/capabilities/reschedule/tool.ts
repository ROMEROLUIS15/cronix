import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult, BookingEventData }  from '../../types.ts'
import { localToUTC, buildEndISO, utcToLocalParts } from '../../core/time-format.ts'
import { extractSlotsFromCorpus, nameMentionedInCorpus } from '../../core/conversation/slot-extractor.ts'
import { resolveClient, needsConfirmation, formatConfirmationPrompt } from '../../core/repos/clients.ts'
import { resolveService } from '../../core/repos/services.ts'
import {
  findAppointmentByClientName, findAppointmentById, findConflicts, resolveAppointmentServiceId,
} from '../../core/repos/appointments.ts'

export interface RescheduleArgs extends Record<string, unknown> {
  client_name: string
  /** When supplied (anaphoric path), look up directly by ID. */
  appointment_id?: string
  /** Existing appointment date — optional disambiguator (explicit path). */
  date?:       string
  /** Existing appointment time — optional disambiguator (explicit path). */
  time?:       string
  new_date?:   string
  new_time?:   string
}

export async function executeReschedule(
  ctx:  ToolContext,
  args: RescheduleArgs,
): Promise<ToolResult> {
  if (!args.client_name) {
    return { success: false, result: 'Necesito saber a quién reagendar.' }
  }

  // Recover new_date / new_time the LLM may have dropped across turns.
  // Mirrors the schedule-tool override so multi-turn reschedule collection
  // stays robust under the same Llama drift.
  if (ctx.userTextCorpus) {
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
    const fromCorpus = extractSlotsFromCorpus(ctx.userTextCorpus, todayLocal)
    if (!args.new_date && fromCorpus.date) {
      console.log(`[VOICE-WORKER-RESCHEDULE] new_date from corpus → "${fromCorpus.date}"`)
      args = { ...args, new_date: fromCorpus.date }
    }
    if (!args.new_time && fromCorpus.time) {
      console.log(`[VOICE-WORKER-RESCHEDULE] new_time from corpus → "${fromCorpus.time}"`)
      args = { ...args, new_time: fromCorpus.time }
    }
  }

  if (!args.new_date && !args.new_time) {
    return { success: false, result: '¿Para qué fecha y hora la reagendo?' }
  }

  // Two lookup paths:
  //   - anaphoric: we know the exact appointment_id from lastRef, so the
  //     date-based search is skipped entirely. Client comes from the row.
  //   - explicit: the user named the client, so we resolve it and search by
  //     name + optional date/time disambiguator.
  let apt: Awaited<ReturnType<typeof findAppointmentById>>
  let clientName: string

  if (args.appointment_id) {
    apt = await findAppointmentById(ctx, args.appointment_id)
    if ('error' in apt) return { success: false, result: apt.error }
    // Recover the client's display name from the appointment row.
    const { data: cli } = await ctx.supabase
      .from('clients')
      .select('name')
      .eq('id', apt.client_id!)
      .single()
    clientName = (cli as { name?: string } | null)?.name ?? args.client_name
  } else {
    // Anti-substitution guard (explicit-name path only — the anaphoric branch
    // resolves by appointment_id). Reschedule is destructive: never act on a
    // registered name the user didn't say.
    const corpus = ctx.userTextCorpus ?? ''
    if (corpus && !nameMentionedInCorpus(corpus, args.client_name)) {
      console.log(`[VOICE-WORKER-RESCHEDULE] REJECTED — hallucinated client="${args.client_name}"`)
      return { success: false, result: 'No te entendí bien el nombre. ¿A quién le reagendo la cita?', error: 'GUARD_REJECTED' }
    }
    const resolution = await resolveClient(ctx, args.client_name)
    if (resolution.status !== 'found') {
      if (resolution.status === 'ambiguous') {
        const names = resolution.candidates.map(c => c.name).join(', ')
        return { success: false, result: `Hay varios clientes similares: ${names}. ¿Cuál?` }
      }
      return {
        success:          false,
        result:           `No encontré al cliente "${args.client_name}".`,
        fallthroughToLLM: true,
      }
    }
    if (needsConfirmation(resolution)) {
      return { success: false, result: formatConfirmationPrompt(resolution, args.client_name) }
    }
    apt = await findAppointmentByClientName(ctx, resolution.client, args.date, args.time)
    if ('error' in apt) return { success: false, result: apt.error }
    clientName = resolution.client.name
  }

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

  // When only one of (new_date, new_time) was given, keep the other from the
  // existing appointment so the user can say "reagéndala a las 4" without
  // having to repeat the date. start_at is UTC — convert to the business-local
  // day/hour, otherwise localToUTC below would re-offset it (wrong day/hour).
  const { date: existingDate, time: existingTime } = utcToLocalParts(apt.start_at, ctx.timezone)
  const finalDate = args.new_date ?? existingDate
  const finalTime = args.new_time ?? existingTime

  const newStartISO = localToUTC(finalDate, finalTime, ctx.timezone)
  const newEndISO   = buildEndISO(newStartISO, durationMin)

  if (await findConflicts(ctx, newStartISO, newEndISO, apt.id)) {
    return { success: false, result: `El horario ${finalTime} del ${finalDate} ya está ocupado. Elige otra hora.` }
  }

  if (ctx.runWriteGuard) {
    const denied = await ctx.runWriteGuard('reschedule_appointment', {
      appointmentId: apt.id,
      clientName,
      serviceName,
      previousDate: existingDate,
      previousTime: existingTime,
      newDate:      finalDate,
      newTime:      finalTime,
    })
    if (denied) return denied
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ start_at: newStartISO, end_at: newEndISO })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude reagendar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName,
    serviceName,
    date: finalDate,
    time: finalTime,
    action: 'rescheduled',
  }
  return {
    success: true,
    result:  `Listo. Reagendé la cita de ${clientName} para el ${finalDate} a las ${finalTime}.`,
    data,
  }
}
