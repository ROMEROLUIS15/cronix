import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult, BookingEventData }  from '../../types.ts'
import { localToUTC, buildEndISO } from '../../core/time-format.ts'
import { resolveClient } from '../../core/repos/clients.ts'
import { resolveService } from '../../core/repos/services.ts'
import { findAppointmentByClientName, findConflicts, resolveAppointmentServiceId } from '../../core/repos/appointments.ts'

export interface RescheduleArgs extends Record<string, unknown> {
  client_name: string
  /** Existing appointment date — optional disambiguator. */
  date?:       string
  /** Existing appointment time — optional disambiguator. */
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
  if (!args.new_date && !args.new_time) {
    return { success: false, result: '¿Para qué fecha y hora la reagendo?' }
  }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status !== 'found') {
    if (resolution.status === 'ambiguous') {
      const names = resolution.candidates.map(c => c.name).join(', ')
      return { success: false, result: `Hay varios clientes similares: ${names}. ¿Cuál?` }
    }
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  const apt = await findAppointmentByClientName(ctx, resolution.client, args.date, args.time)
  if ('error' in apt) return { success: false, result: apt.error }

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
  // having to repeat the date.
  const existingDate = apt.start_at.slice(0, 10)
  const existingTime = apt.start_at.slice(11, 16)
  const finalDate = args.new_date ?? existingDate
  const finalTime = args.new_time ?? existingTime

  const newStartISO = localToUTC(finalDate, finalTime, ctx.timezone)
  const newEndISO   = buildEndISO(newStartISO, durationMin)

  if (await findConflicts(ctx, newStartISO, newEndISO, apt.id)) {
    return { success: false, result: `El horario ${finalTime} del ${finalDate} ya está ocupado. Elige otra hora.` }
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ start_at: newStartISO, end_at: newEndISO })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude reagendar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName:    resolution.client.name,
    serviceName,
    date: finalDate,
    time: finalTime,
    action: 'rescheduled',
  }
  return {
    success: true,
    result:  `Listo. Reagendé la cita de ${resolution.client.name} para el ${finalDate} a las ${finalTime}.`,
    data,
  }
}
