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

export function parseLateReminder(body: unknown): LateReminderRequest | null {
  const late = (body as { lateReminder?: Record<string, unknown> } | null)?.lateReminder
  if (!late) return null
  const { businessId, appointmentId, rescheduled } = late
  if (typeof businessId !== 'string' || !businessId) return null
  if (typeof appointmentId !== 'string' || !appointmentId) return null
  return { businessId, appointmentId, rescheduled: rescheduled === true }
}

function localParts(at: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function isLateForTonight(startAt: string, timezone: string, now: Date): boolean {
  const today = localParts(now, timezone)
  return today.time >= LATE_WINDOW_START && localParts(new Date(startAt), timezone).date === nextDay(today.date)
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
