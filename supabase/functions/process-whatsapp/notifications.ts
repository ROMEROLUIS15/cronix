/**
 * notifications.ts — The WhatsApp agent's appointment events.
 *
 * Typed convenience builders called from tool-executor.ts over the shared pipeline
 * (_shared/notifications/emit-booking-event.ts), which the phone line uses too. The
 * contract/message builders live in _shared/notifications/notif-contracts.ts.
 */

import { utcToLocalParts } from "./time-utils.ts"
import { buildAppointmentEventId } from "../_shared/notifications/event-id.ts"
import type { BusinessRagContext } from "./types.ts"
import { type ChangeRequest, buildChangeRequestEvent } from "../_shared/notifications/notif-contracts.ts"
import { emitBookingEvent } from "../_shared/notifications/emit-booking-event.ts"

export { emitBookingEvent }

// ── Convenience builders (called from tool-executor.ts) ───────────────────────
// Each constructs a typed AppointmentEvent and fires emitBookingEvent. Deterministic
// event IDs (buildAppointmentEventId): same action + appointment + date/time = same id,
// so a ReAct/QStash retry can't create a duplicate owner notification.

export function emitCreatedEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  date:          string,
  time:          string,
  appointmentId: string,
): void {
  void emitBookingEvent({
    eventId:      buildAppointmentEventId('created', business.id, appointmentId, date, time),
    type:         'appointment.created',
    businessId:   business.id,
    businessName: business.name,
    clientName, serviceName, date, time,
    userId:       'whatsapp-agent',
    channel:      'whatsapp',
  })
}

export function emitRescheduledEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  appointmentId: string,
  newDate:       string,
  newTime:       string,
): void {
  void emitBookingEvent({
    eventId:      buildAppointmentEventId('rescheduled', business.id, appointmentId, newDate, newTime),
    type:         'appointment.rescheduled',
    businessId:   business.id,
    businessName: business.name,
    clientName, serviceName,
    date:         newDate,
    time:         newTime,
    userId:       'whatsapp-agent',
    channel:      'whatsapp',
  })
}

/**
 * A client asked to cancel/reschedule an appointment but has not confirmed (operacion-
 * canonica O3): the owner learns now, even if the client never finishes. Called from the
 * deterministic booking layer on every turn that targets one appointment; the event id
 * is keyed on the appointment slot, so only the first turn reaches the owner.
 */
export function emitChangeRequestedEvent(
  business:   BusinessRagContext['business'],
  clientName: string,
  request:    ChangeRequest,
): void {
  void emitBookingEvent(buildChangeRequestEvent(business, clientName, request))
}

export function emitCancelledEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  appointmentId: string,
  oldStartAt:    string,
): void {
  // Convert the stored UTC ISO start_at to the business's local tz for humans.
  const { date, time } = utcToLocalParts(oldStartAt, business.timezone)
  void emitBookingEvent({
    eventId:      buildAppointmentEventId('cancelled', business.id, appointmentId, date, time),
    type:         'appointment.cancelled',
    businessId:   business.id,
    businessName: business.name,
    clientName, serviceName, date, time,
    userId:       'whatsapp-agent',
    channel:      'whatsapp',
  })
}
