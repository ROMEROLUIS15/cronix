/**
 * emit-booking-event.ts — Emits an AppointmentEvent through the owner-notification pipeline,
 * for every channel that books (WhatsApp, the phone line, the voice button, the dashboard):
 *   1. Idempotency check (event_id in DB)
 *   2. Persist to notifications table (source of truth)
 *   3. Realtime broadcast (dashboard bell)
 *   4. WhatsApp to owner (template-first, free-text fallback), unless the owner made the change
 *   5. Web push to the owner's PWA
 *   6. The client's reminder, when the booking came too late for that night's 20:00 run
 *      (late-reminder.ts; not for the WhatsApp agent)
 *
 * Order: DB → Realtime → WhatsApp → push (WA/push only if DB succeeded). The client's
 * reminder does not depend on the owner's bell. A retry of an event already processed
 * sends nothing. Never throws to the caller: the booking is already committed.
 */

import { captureException } from "../sentry.ts"
import type { AppointmentEvent } from "./notif-contracts.ts"
import {
  checkEventExists, saveNotificationToDB, pushToRealtime, sendOwnerWhatsApp, sendOwnerWebPush,
} from "./notif-channels.ts"
import { requestLateReminder } from "./late-reminder.ts"

export async function emitBookingEvent(event: AppointmentEvent): Promise<void> {
  try {
    if (await checkEventExists(event.eventId)) {
      console.info('[NOTIFICATION] Event already processed — skipping', event.eventId)
      return
    }
    // DB is the source of truth — must succeed before the other owner channels.
    if (await saveNotificationToDB(event)) {
      await pushToRealtime(event)
      if (!event.ownerActed) await sendOwnerWhatsApp(event)
      await sendOwnerWebPush(event)
    }
  } catch (err) {
    captureException(err, { stage: 'emit_booking_event', eventId: event.eventId })
  }
  await requestLateReminder(event)
}
