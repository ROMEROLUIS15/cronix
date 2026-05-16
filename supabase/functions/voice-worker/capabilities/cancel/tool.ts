import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult, BookingEventData } from '../../types.ts'
import { resolveClient, needsConfirmation, formatConfirmationPrompt } from '../../core/repos/clients.ts'
import { resolveService } from '../../core/repos/services.ts'
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
    date: apt.start_at.slice(0, 10),
    time: apt.start_at.slice(11, 16),
    action: 'cancelled',
  }
  return {
    success: true,
    result:  `Listo. Cancelé la cita de ${clientName} (${serviceName}).`,
    data,
  }
}
