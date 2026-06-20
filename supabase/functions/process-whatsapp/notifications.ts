/**
 * notifications.ts — Facade for emitting appointment events (WhatsApp pipeline).
 *
 * The only entry point is emitBookingEvent() (+ the typed convenience builders called
 * from tool-executor.ts). It replicates the NotificationService contract inside the Deno
 * runtime (can't import Next.js modules):
 *   1. Idempotency check (event_id in DB)
 *   2. Persist to notifications table (source of truth)
 *   3. Realtime broadcast (dashboard bell)
 *   4. WhatsApp to owner (template-first, free-text fallback)
 *   5. Web push to the owner's PWA
 *
 * Order: DB → Realtime → WhatsApp → push (WA/push only if DB succeeded). Fire-and-forget
 * safe: never throws to the caller; the booking is already committed. The contract/message
 * builders live in notif-contracts.ts and the side-effect channels in notif-channels.ts.
 */

import { captureException } from "../_shared/sentry.ts"
import { utcToLocalParts } from "./time-utils.ts"
import { buildAppointmentEventId } from "../_shared/notifications/event-id.ts"
import type { BusinessRagContext } from "./types.ts"
import type { AppointmentEvent } from "./notif-contracts.ts"
import {
  checkEventExists, saveNotificationToDB, pushToRealtime, sendOwnerWhatsApp, sendOwnerWebPush,
} from "./notif-channels.ts"

/** Emits an AppointmentEvent through the full notification pipeline (fire-and-forget safe). */
export async function emitBookingEvent(event: AppointmentEvent): Promise<void> {
  try {
    if (await checkEventExists(event.eventId)) {
      console.info('[NOTIFICATION-WA] Event already processed — skipping', event.eventId)
      return
    }
    // DB is the source of truth — must succeed before the other channels.
    if (!(await saveNotificationToDB(event))) return
    await pushToRealtime(event)
    await sendOwnerWhatsApp(event)
    await sendOwnerWebPush(event)
  } catch (err) {
    captureException(err, { stage: 'emit_booking_event', eventId: event.eventId })
  }
}

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
