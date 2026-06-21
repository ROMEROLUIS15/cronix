/**
 * booking-shared.ts — Types, constants and pure helpers shared by the booking modules
 * (new-booking state, cancel-flow, reschedule-flow and the dispatcher). No business
 * logic of its own: just the vocabulary the deterministic booking flow is built from.
 */

import { parseDateExpression } from './date-parser.ts'
import { formatLocalTime } from './prompt-builder.ts'
import { todayInTimezone, nextOpenDates, type WorkingHours } from './availability.ts'
import { utcToLocalParts } from './time-utils.ts'

export type ServiceLite    = { id: string; name: string; duration_min: number }
export type ActiveApptLite = { id: string; service_name: string; start_at: string }

export type BookingTurn =
  | { kind: 'reply';   text: string }
  | { kind: 'execute';           serviceId: string;     serviceName: string; date: string;    time: string }
  | { kind: 'executeCancel';     appointmentId: string; serviceName: string; date: string;    time: string }
  | { kind: 'executeReschedule'; appointmentId: string; serviceName: string; newDate: string; newTime: string }
  | null

const MAX_LISTED = 8

// A completed/closed booking — ends booking context so we don't re-propose.
export const BOOKING_DONE_RE = /(qued[óo]\s+agendada|cita\s+reagendada|ha\s+sido\s+cancelada|listo!\s)/i
// Our OWN reschedule questions/proposal — keep the reschedule sub-dialogue sticky across
// turns and out of the new-booking state machine (its time question overlaps the booking one).
// `reagendamos`/`para reagendar` cover the RETRY prompts (closed day / slot taken), which
// otherwise matched only the NEW-booking sticky regex and dropped the reschedule context.
// Both phrases are unique to the reschedule retries — the success message says "reagendada".
export const OUR_RESCHEDULE_QUESTION_RE =
  /(nueva\s+fecha\s+quieres\s+reagendar|hora\s+quieres\s+tu\s+cita|cu[áa]l\s+deseas\s+reagendar|¿\s*reagendo\s+tu\s+cita|reagendamos|para\s+reagendar)/i

export function humanDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

export function listFreeTimes(slots: string[]): string {
  const list = slots.slice(0, MAX_LISTED).map(formatLocalTime).join(', ')
  return slots.length > MAX_LISTED ? `${list}, entre otros` : list
}

export function apptLocal(a: ActiveApptLite, tz: string): { date: string; time: string } {
  return utcToLocalParts(a.start_at, tz)
}

/** Narrows active appointments by the service and/or date named in the text. */
export function matchAppointments(
  text: string, appts: ReadonlyArray<ActiveApptLite>, tz: string,
): ActiveApptLite[] {
  const t = text.toLowerCase()
  const byService = appts.filter((a) => a.service_name && t.includes(a.service_name.toLowerCase()))
  const parsed    = parseDateExpression(text, todayInTimezone(tz), 'nearest')
  const byDate    = parsed ? appts.filter((a) => apptLocal(a, tz).date === parsed.date) : []

  if (byService.length && byDate.length) {
    const both = byService.filter((a) => byDate.includes(a))
    if (both.length) return both
  }
  if (byService.length) return byService
  if (byDate.length)    return byDate
  return [...appts]
}

export function listActiveAppointments(
  appts: ReadonlyArray<ActiveApptLite>, tz: string, verb: 'cancelar' | 'reagendar',
): string {
  const list = appts.slice(0, 5).map((a, i) => {
    const { date, time } = apptLocal(a, tz)
    return `${i + 1}. *${a.service_name}* — ${humanDate(date)} a las ${formatLocalTime(time)}`
  }).join('\n')
  return `Tienes varias citas activas:\n\n${list}\n\n¿Cuál deseas ${verb}?`
}

/** Lowercase + strip accents so "electronica" matches the service "Electrónica". */
export function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

/** The service named in the text (substring either way, min 3 chars reverse), accent-insensitive.
 *  Generic over any {name} row so both the booking state machine and the services layer share it. */
export function serviceNamedIn<T extends { name: string }>(text: string, services: ReadonlyArray<T>): T | null {
  const t = foldText(text)
  if (!t) return null
  return services.find((s) => {
    const n = foldText(s.name)
    return !!n && (t.includes(n) || (t.length >= 3 && n.includes(t)))
  }) ?? null
}

/** "el lunes 29 de junio o el martes 30 de junio" — next open days, or '' if none. */
export function suggestOpenDays(wh: WorkingHours, fromISO: string, count = 2): string {
  const parts = nextOpenDates(wh, fromISO, count).map((iso) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
    const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'UTC' })
    return `el ${weekday} ${humanDate(iso)}`
  })
  return parts.join(' o ')
}

/**
 * "La última cita del día empieza a las 4:00 pm." — only when the requested time is AFTER
 * the last free slot (the service doesn't fit before closing), which is the common
 * confusion: a long service can't START near closing time. '' otherwise.
 */
export function cutoffHint(requestedTime: string, slots: string[]): string {
  const last = slots[slots.length - 1]
  return last && requestedTime > last ? ` La última cita del día empieza a las ${formatLocalTime(last)}.` : ''
}
