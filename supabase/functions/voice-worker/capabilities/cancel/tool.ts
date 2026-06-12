import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult, BookingEventData } from '../../types.ts'
import { utcToLocalParts } from '../../core/time-format.ts'
import { resolveClient, needsConfirmation, formatConfirmationPrompt } from '../../core/repos/clients.ts'
import { resolveService } from '../../core/repos/services.ts'
import { nameMentionedInCorpus } from '../../core/conversation/slot-extractor.ts'
import {
  findAppointmentByClientName, findAppointmentById, resolveAppointmentServiceId,
} from '../../core/repos/appointments.ts'

export interface CancelArgs extends Record<string, unknown> {
  client_name:    string
  /** When supplied (anaphoric path), look up directly by ID. */
  appointment_id?: string
  date?:          string
  time?:          string
}

export async function executeCancel(
  ctx:  ToolContext,
  args: CancelArgs,
): Promise<ToolResult> {
  if (!args.client_name) {
    return { success: false, result: 'Necesito el nombre del cliente para cancelar.' }
  }

  let apt: Awaited<ReturnType<typeof findAppointmentById>>
  let clientName: string

  if (args.appointment_id) {
    apt = await findAppointmentById(ctx, args.appointment_id)
    if ('error' in apt) return { success: false, result: apt.error }
    const { data: cli } = await ctx.supabase
      .from('clients')
      .select('name')
      .eq('id', apt.client_id!)
      .single()
    clientName = (cli as { name?: string } | null)?.name ?? args.client_name
  } else {
    // Anti-substitution guard (explicit-name path only — the anaphoric branch
    // above resolves by appointment_id and never trusts a model-supplied name).
    // A cancel is destructive: never act on a registered name the user didn't say.
    const corpus = ctx.userTextCorpus ?? ''
    if (corpus && !nameMentionedInCorpus(corpus, args.client_name)) {
      console.log(`[VOICE-WORKER-CANCEL] REJECTED — hallucinated client="${args.client_name}"`)
      return { success: false, result: 'No te entendí bien el nombre. ¿A quién le cancelo la cita?', error: 'GUARD_REJECTED' }
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

  let serviceName = 'Servicio'
  const serviceId = resolveAppointmentServiceId(apt)
  if (serviceId) {
    const svc = await resolveService(ctx, serviceId)
    if (svc) serviceName = svc.name
  }

  // start_at is stored in UTC — render it in the business timezone so the
  // notification and write-guard see the local day/hour the user actually means.
  const { date: localDate, time: localTime } = utcToLocalParts(apt.start_at, ctx.timezone)

  if (ctx.runWriteGuard) {
    const denied = await ctx.runWriteGuard('cancel_appointment', {
      appointmentId: apt.id,
      clientName,
      serviceName,
      date: localDate,
      time: localTime,
    })
    if (denied) return denied
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude cancelar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName,
    serviceName,
    date: localDate,
    time: localTime,
    action: 'cancelled',
  }
  return {
    success: true,
    result:  `Listo. Cancelé la cita de ${clientName} (${serviceName}).`,
    data,
  }
}
