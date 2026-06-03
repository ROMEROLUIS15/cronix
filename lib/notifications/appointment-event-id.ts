/**
 * appointment-event-id.ts — Canonical appointment-notification event ID (Node).
 *
 * Byte-identical mirror of the Deno source of truth at
 * supabase/functions/_shared/notifications/event-id.ts. Node (dashboard) and
 * Deno (WhatsApp / Voice Edge Functions) cannot share a module across runtimes
 * (see ADR-0008), so the format is duplicated here and kept in sync by the
 * parity test in __tests__/notifications/appointment-event-id.test.ts.
 *
 * Format (stable — do NOT reorder segments):
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
  action: AppointmentAction,
  businessId: string,
  appointmentId: string,
  date: string,
  time: string,
): string {
  return `${action}:${businessId}:${appointmentId}:${date}:${time}`
}
