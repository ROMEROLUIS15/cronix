/**
 * event-id.ts — Canonical appointment-notification event ID.
 *
 * Shared by EVERY channel that emits appointment notifications. The SAME logical
 * event (created / rescheduled / cancelled for a given appointment at a given
 * local date+time) MUST map to the SAME id, regardless of how many times a
 * channel retries — that is what lets the `notifications.event_id` UNIQUE
 * constraint dedup notifications at the database level.
 *
 * Format (stable — do NOT reorder segments; the Node mirror in
 * lib/notifications/appointment-event-id.ts MUST produce byte-identical output):
 *
 *   {action}:{businessId}:{appointmentId}:{date}:{time}
 *
 * - action:        'created' | 'rescheduled' | 'cancelled'
 * - businessId:    tenant UUID
 * - appointmentId: appointment UUID
 * - date:          YYYY-MM-DD in the business timezone
 * - time:          HH:mm (24h)  in the business timezone
 */

export type AppointmentAction = 'created' | 'rescheduled' | 'cancelled'

export function buildAppointmentEventId(
  action:        AppointmentAction,
  businessId:    string,
  appointmentId: string,
  date:          string,
  time:          string,
): string {
  return `${action}:${businessId}:${appointmentId}:${date}:${time}`
}
