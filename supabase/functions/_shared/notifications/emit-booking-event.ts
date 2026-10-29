/**
 * emit-booking-event.ts — Emits an AppointmentEvent through the owner-notification pipeline,
 * for every channel that books (WhatsApp, the phone line):
 *   1. Idempotency check (event_id in DB)
 *   2. Persist to notifications table (source of truth)
 *   3. Realtime broadcast (dashboard bell)
 *   4. WhatsApp to owner (template-first, free-text fallback)
 *   5. Web push to the owner's PWA
 *
 * Order: DB → Realtime → WhatsApp → push (WA/push only if DB succeeded). Never throws to
 * the caller: the booking is already committed.
 */

import { captureException } from "../sentry.ts"
import type { AppointmentEvent } from "./notif-contracts.ts"
import {
  checkEventExists, saveNotificationToDB, pushToRealtime, sendOwnerWhatsApp, sendOwnerWebPush,
} from "./notif-channels.ts"

export async function emitBookingEvent(event: AppointmentEvent): Promise<void> {
  try {
    if (await checkEventExists(event.eventId)) {
      console.info('[NOTIFICATION] Event already processed — skipping', event.eventId)
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
