/**
 * cancel-flow.ts — Cancel an EXISTING appointment (deterministic).
 *
 * Identifies the appointment from the active list (by service/date named, or the single
 * one) and proposes the cancel confirmation; recovers it back from OUR proposal so the
 * "sí" can execute. The LLM never proposes a cancel.
 */

import { parseDateExpression } from './date-parser.ts'
import { extractTime } from './datetime-nlu.ts'
import { formatLocalTime } from './prompt-builder.ts'
import { todayInTimezone } from './availability.ts'
import {
  type ActiveApptLite, type BookingTurn,
  apptLocal, humanDate, matchAppointments, listActiveAppointments,
} from './booking-shared.ts'

/** Cancel intent → identify the appointment and propose the confirmation. */
export function resolveCancelIntent(
  text: string, appts: ReadonlyArray<ActiveApptLite>, tz: string,
): BookingTurn {
  if (appts.length === 0) {
    return { kind: 'reply', text: 'No veo ninguna cita activa a tu nombre. ¿Quieres agendar una nueva?' }
  }
  const cands = appts.length === 1 ? [...appts] : matchAppointments(text, appts, tz)
  if (cands.length === 1) {
    const a = cands[0]!
    const { date, time } = apptLocal(a, tz)
    return { kind: 'reply', text: `¿Confirmas que cancele tu cita de *${a.service_name}* del ${humanDate(date)} a las ${formatLocalTime(time)}?` }
  }
  return { kind: 'reply', text: listActiveAppointments(cands, tz, 'cancelar') }
}

/** Recovers the appointment to cancel from OUR cancel proposal + active list. */
export function recoverCancelProposal(
  proposal: string, appts: ReadonlyArray<ActiveApptLite>, tz: string,
): ActiveApptLite | null {
  const m = proposal.match(/cancele tu cita de \*(.+?)\* del (.+?) a las (.+?)[?¿]/i)
  if (!m) return null
  const svc  = m[1]!.trim().toLowerCase()
  const cand = appts.filter((a) => a.service_name?.toLowerCase().includes(svc) || svc.includes(a.service_name?.toLowerCase() ?? '\0'))
  if (cand.length === 1) return cand[0]!
  const pd   = parseDateExpression(m[2]!, todayInTimezone(tz), 'nearest')?.date
  const time = extractTime(m[3]!)
  return cand.find((a) => { const l = apptLocal(a, tz); return l.date === pd && (!time || l.time === time) }) ?? cand[0] ?? null
}
