/**
 * notif-contracts.ts — AppointmentEvent contract + pure message builders.
 *
 * The shape (mirrors lib/ai/orchestrator/events.ts) and the title/content/owner-message
 * builders, with no side effects — shared by the channels and the facade.
 */

import { formatLocalTime } from "./prompt-builder.ts"
import { buildAppointmentEventId } from "../_shared/notifications/event-id.ts"

export type AppointmentEventType =
  | 'appointment.created'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'
  // A request the client has not confirmed yet (operacion-canonica O3).
  | 'appointment.reschedule_requested'
  | 'appointment.cancel_requested'

export interface AppointmentEvent {
  eventId:      string
  type:         AppointmentEventType
  businessId:   string
  businessName: string
  clientName:   string
  serviceName:  string
  date:         string
  time:         string
  /** Reschedule request: the new date the client asked for, when stated. */
  requestedDate?: string | null
  userId:       string
  channel:      'whatsapp'
}

/** A client's request to cancel/reschedule ONE appointment, before they confirm it. */
export interface ChangeRequest {
  type:          'cancel' | 'reschedule'
  appointmentId: string
  serviceName:   string
  /** The appointment's current local date/time (it is untouched until confirmed). */
  date:          string
  time:          string
  requestedDate: string | null
}

/**
 * Owner alert for a pending request. The id is keyed on the appointment slot, so the
 * same request alerts once however many turns the conversation takes.
 */
export function buildChangeRequestEvent(
  business: { id: string; name: string }, clientName: string, req: ChangeRequest,
): AppointmentEvent {
  const action = req.type === 'cancel' ? 'cancel_requested' : 'reschedule_requested'
  return {
    eventId:       buildAppointmentEventId(action, business.id, req.appointmentId, req.date, req.time),
    type:          `appointment.${action}`,
    businessId:    business.id,
    businessName:  business.name,
    clientName,
    serviceName:   req.serviceName,
    date:          req.date,
    time:          req.time,
    requestedDate: req.requestedDate,
    userId:        'whatsapp-agent',
    channel:       'whatsapp',
  }
}

/** The `notifications.type` (bell styling) for an event. */
export function notificationKind(type: AppointmentEventType): 'success' | 'info' | 'warning' {
  switch (type) {
    case 'appointment.cancelled':
    case 'appointment.cancel_requested':     return 'warning'
    case 'appointment.reschedule_requested': return 'info'
    default:                                 return 'success'
  }
}

export function buildTitle(type: AppointmentEventType): string {
  switch (type) {
    case 'appointment.created':              return 'Nueva cita agendada'
    case 'appointment.rescheduled':          return 'Cita reagendada'
    case 'appointment.cancelled':            return 'Cita cancelada'
    case 'appointment.reschedule_requested': return 'Pidió reagendar (pendiente)'
    case 'appointment.cancel_requested':     return 'Pidió cancelar (pendiente)'
  }
}

export function buildContent(event: AppointmentEvent): string {
  const base = `${event.clientName} — ${event.serviceName} el ${event.date} a las ${event.time}`
  switch (event.type) {
    case 'appointment.created':     return `Nueva cita: ${base}`
    case 'appointment.rescheduled': return `Reagendada: ${base}`
    case 'appointment.cancelled':   return `Cancelada: ${base}`
    case 'appointment.reschedule_requested':
      return `Pidió reagendar: ${base}.${event.requestedDate ? ` Quiere el ${event.requestedDate}.` : ''} Aún no confirma.`
    case 'appointment.cancel_requested':
      return `Pidió cancelar: ${base}. Aún no confirma.`
  }
}

export function buildOwnerWhatsAppMessage(event: AppointmentEvent): string {
  // Convert HH:mm (24h) → "h:mm am/pm"; fall back to raw value if format unexpected.
  const prettyTime = /^\d{2}:\d{2}$/.test(event.time) ? formatLocalTime(event.time) : event.time
  switch (event.type) {
    case 'appointment.created':
      return (
        `¡Hola! 👋🤖\n\n` +
        `Ha sido agendada una cita para *${event.clientName}* el día *${event.date}* a las *${prettyTime}*\n` +
        `Servicio: *${event.serviceName}*\n\n` +
        `¡Reserva confirmada vía WhatsApp! 💪🚀`
      )
    case 'appointment.rescheduled':
      return (
        `¡Reagenda! 🔄🤖\n\n` +
        `*${event.clientName}* movió su cita de *${event.serviceName}*.\n` +
        `Nueva fecha: *${event.date}* a las *${prettyTime}*\n\n` +
        `¡Tu agenda ha sido actualizada! 💪🚀`
      )
    case 'appointment.cancelled':
      return (
        `¡Cita cancelada! ❌🤖\n\n` +
        `*${event.clientName}* canceló su cita de *${event.serviceName}*` +
        (event.date ? ` del *${event.date}* a las *${prettyTime}*` : '') +
        `.\n\n¡Tienes un nuevo espacio libre! 💪🚀`
      )
    case 'appointment.reschedule_requested':
    case 'appointment.cancel_requested': {
      const verb = event.type === 'appointment.cancel_requested' ? 'cancelar' : 'reagendar'
      return (
        `¡Atención! ⏳🤖\n\n` +
        `*${event.clientName}* pidió ${verb} su cita de *${event.serviceName}* del *${event.date}* a las *${prettyTime}*.\n` +
        (event.requestedDate ? `Quiere: *${event.requestedDate}*\n` : '') +
        `\nTodavía no confirmó: la cita sigue en pie. Te aviso cuando se complete.`
      )
    }
  }
}

export function formatDateHuman(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}
