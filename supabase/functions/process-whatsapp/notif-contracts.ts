/**
 * notif-contracts.ts — AppointmentEvent contract + pure message builders.
 *
 * The shape (mirrors lib/ai/orchestrator/events.ts) and the title/content/owner-message
 * builders, with no side effects — shared by the channels and the facade.
 */

import { formatLocalTime } from "./prompt-builder.ts"

export type AppointmentEventType =
  | 'appointment.created'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'

export interface AppointmentEvent {
  eventId:      string
  type:         AppointmentEventType
  businessId:   string
  businessName: string
  clientName:   string
  serviceName:  string
  date:         string
  time:         string
  userId:       string
  channel:      'whatsapp'
}

export function buildTitle(type: AppointmentEventType): string {
  switch (type) {
    case 'appointment.created':     return 'Nueva cita agendada'
    case 'appointment.rescheduled': return 'Cita reagendada'
    case 'appointment.cancelled':   return 'Cita cancelada'
  }
}

export function buildContent(event: AppointmentEvent): string {
  const base = `${event.clientName} — ${event.serviceName} el ${event.date} a las ${event.time}`
  switch (event.type) {
    case 'appointment.created':     return `Nueva cita: ${base}`
    case 'appointment.rescheduled': return `Reagendada: ${base}`
    case 'appointment.cancelled':   return `Cancelada: ${base}`
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
  }
}

export function formatDateHuman(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}
