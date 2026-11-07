import { localDate, nextLocalDate } from './tomorrow-range.ts'
import type { AppointmentWithClient, BusinessRow } from '../types.ts'

/**
 * The client reminder of an appointment booked or moved too late for that night's 20:00
 * run. `_shared/notifications/late-reminder.ts` forwards every booking from the dashboard,
 * the voice button and the phone line; this decides whether it is late and sends it with
 * the nightly run's own sender (record, session anchor, WhatsApp switch of the business).
 *
 * Late = the appointment is tomorrow in the business timezone and it is 19:55 or later
 * there. The five minutes before 20:00 cover a booking made while the run starts; the
 * run skips one already reminded, so the client never gets two.
 */
export const LATE_WINDOW_START = '19:55'

export interface LateReminderRequest {
  businessId: string
  appointmentId: string
  rescheduled: boolean
}

export type AppointmentWithStatus = AppointmentWithClient & { status: string }

interface SendResult { sent: number; failed: number; failedAppointments: AppointmentWithClient[] }

export interface LateReminderDeps {
  loadBusiness(businessId: string): Promise<BusinessRow | null>
  loadAppointment(businessId: string, appointmentId: string): Promise<AppointmentWithStatus | null>
  skippedIds(businessId: string, appointmentId: string, options: { resend: boolean }): Promise<Set<string>>
  send(business: BusinessRow, appointment: AppointmentWithClient, skipped: Set<string>): Promise<SendResult>
}

export type LateReminderOutcome = 'sent' | 'failed' | 'skipped' | 'not_late' | 'not_found'

const NOT_REMINDED = new Set(['cancelled', 'no_show'])

/**
 * null: not a late request (the hourly pg_cron body). 'invalid': a late request with a
 * bad shape, answered 400 so it never falls through to the whole nightly run.
 */
export function parseLateReminder(body: unknown): LateReminderRequest | 'invalid' | null {
  if (!body || typeof body !== 'object' || !('lateReminder' in body)) return null
  const late = (body as { lateReminder: unknown }).lateReminder
  if (!late || typeof late !== 'object') return 'invalid'
  const { businessId, appointmentId, rescheduled } = late as Record<string, unknown>
  if (typeof businessId !== 'string' || !businessId) return 'invalid'
  if (typeof appointmentId !== 'string' || !appointmentId) return 'invalid'
  return { businessId, appointmentId, rescheduled: rescheduled === true }
}

function localTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(at)
}

export function isLateForTonight(startAt: string, timezone: string, now: Date): boolean {
  return localTime(now, timezone) >= LATE_WINDOW_START
    && localDate(new Date(startAt), timezone) === nextLocalDate(localDate(now, timezone))
}

export async function handleLateReminder(
  req: LateReminderRequest, deps: LateReminderDeps, now: Date = new Date(),
): Promise<{ outcome: LateReminderOutcome; failedAppointments: AppointmentWithClient[] }> {
  const none = (outcome: LateReminderOutcome) => ({ outcome, failedAppointments: [] })

  const business = await deps.loadBusiness(req.businessId)
  if (!business) return none('not_found')
  const appointment = await deps.loadAppointment(business.id, req.appointmentId)
  if (!appointment || NOT_REMINDED.has(appointment.status)) return none('not_found')
  if (!isLateForTonight(appointment.start_at, business.timezone ?? 'UTC', now)) return none('not_late')

  const skipped = await deps.skippedIds(business.id, appointment.id, { resend: req.rescheduled })
  if (skipped.has(appointment.id)) return none('skipped')

  const result = await deps.send(business, appointment, skipped)
  if (result.sent > 0) return none('sent')
  if (result.failed > 0) return { outcome: 'failed', failedAppointments: result.failedAppointments }
  return none('skipped')
}
