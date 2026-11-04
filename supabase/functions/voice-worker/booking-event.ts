/**
 * booking-event.ts — A write of the voice button, as an event of the shared booking pipeline.
 */

import { type AppointmentEvent, isOwnerActor } from '../_shared/notifications/notif-contracts.ts'
import type { AppointmentNotification } from './types.ts'

export function toBookingEvent(
  notification: AppointmentNotification, businessName: string, userRole: string,
): AppointmentEvent {
  return { ...notification, businessName, channel: 'voice', ownerActed: isOwnerActor(userRole) }
}
