/**
 * reschedule-flow.ts — Reschedule an EXISTING appointment (deterministic, multi-turn).
 *
 * Sticky sub-dialogue: once triggered it gathers the NEW date/time across every turn
 * (supporting "a la misma hora" → the appointment's current time), validates the slot
 * and proposes. The LLM never proposes a reschedule — this is the ONLY source of
 * "¿Reagendo tu cita…?", so the confirmation "sí" can always be recovered and executed.
 */

import { parseDateExpression } from './date-parser.ts'
import { parseDateTime, extractTime } from './datetime-nlu.ts'
import { formatLocalTime } from './prompt-builder.ts'
import { computeAvailableSlots, todayInTimezone, type WorkingHours, type BookedSlot } from './availability.ts'
import { isRescheduleIntent } from './intents.ts'
import {
  type ServiceLite, type ActiveApptLite, type BookingTurn,
  BOOKING_DONE_RE, apptLocal, humanDate, listFreeTimes, matchAppointments, listActiveAppointments,
  suggestOpenDays, cutoffHint,
} from './booking-shared.ts'

// "a la misma hora" / "el mismo horario" → keep the appointment's current time.
const SAME_HOUR_RE = /\b(?:a\s+la\s+)?misma\s+hora\b|\bmismo\s+horario\b|\bigual\s+(?:hora|horario)\b/i

/** Client texts that belong to the CURRENT reschedule sub-dialogue (newest→trigger). */
function rescheduleSubDialogueTexts(
  userText: string, history: ReadonlyArray<{ role: string; text: string }>,
): string[] {
  // The trigger turn itself starts (and bounds) the sub-dialogue.
  if (isRescheduleIntent(userText)) return [userText]
  const texts = [userText]
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h || !h.text) continue
    if (h.role !== 'user' && BOOKING_DONE_RE.test(h.text)) break
    if (h.role === 'user') {
      texts.push(h.text)
      if (isRescheduleIntent(h.text)) break
    }
  }
  return texts
}

export function resolveRescheduleTurn(p: {
  userText: string
  history:  ReadonlyArray<{ role: string; text: string }>
  appts:    ReadonlyArray<ActiveApptLite>
  services: ReadonlyArray<ServiceLite>
  wh:       WorkingHours
  tz:       string
  booked:   ReadonlyArray<BookedSlot>
}): BookingTurn {
  const { userText, history, appts, services, wh, tz, booked } = p
  if (appts.length === 0) {
    return { kind: 'reply', text: 'No veo ninguna cita activa para reagendar. ¿Quieres agendar una nueva?' }
  }
  const texts = rescheduleSubDialogueTexts(userText, history)
  const cands = appts.length === 1 ? [...appts] : matchAppointments(texts.join(' '), appts, tz)
  if (cands.length !== 1) {
    return { kind: 'reply', text: listActiveAppointments(cands, tz, 'reagendar') }
  }
  const target = cands[0]!

  // Gather the NEW date/time from the client's reschedule turns (most recent wins).
  let newDate: string | null = null
  let newTime: string | null = null
  for (const t of texts) {
    const dt = parseDateTime(t, todayInTimezone(tz))
    if (!newDate && dt.date) newDate = dt.date
    if (!newTime && dt.time) newTime = dt.time
    if (newDate && newTime) break
  }
  if (!newTime && texts.some((t) => SAME_HOUR_RE.test(t))) newTime = apptLocal(target, tz).time

  if (!newDate) return { kind: 'reply', text: `¿Para qué nueva fecha quieres reagendar tu cita de *${target.service_name}*?` }

  // Validate the day is OPEN as soon as the date is known — before asking the time — so a
  // closed day is reported immediately (and suggests concrete open days), not after the
  // client also provides a time.
  const dur = services.find((s) => s.name.toLowerCase() === target.service_name.toLowerCase())?.duration_min ?? 30
  const { open, slots } = computeAvailableSlots({ workingHours: wh, date: newDate, timezone: tz, durationMin: dur, bookedSlots: booked })
  const when = humanDate(newDate)
  if (!open) {
    const sugg = suggestOpenDays(wh, newDate)
    return { kind: 'reply', text: `El ${when} el negocio no abre 😕. ¿Para qué otra fecha reagendamos tu cita de *${target.service_name}*?${sugg ? ` Por ejemplo, ${sugg}.` : ''}` }
  }
  if (slots.length === 0) {
    return { kind: 'reply', text: `Para el ${when} no me queda horario libre para reagendar. ¿Probamos con otra fecha?` }
  }
  if (!newTime) {
    return { kind: 'reply', text: `¿A qué hora quieres tu cita de *${target.service_name}* el ${when}? Para reagendar tengo: ${listFreeTimes(slots)}.` }
  }
  if (!slots.includes(newTime)) {
    return { kind: 'reply', text: `A las ${formatLocalTime(newTime)} no tengo disponible el ${when}.${cutoffHint(newTime, slots)} Para reagendar tengo: ${listFreeTimes(slots)}. ¿Cuál prefieres?` }
  }
  const origDate = apptLocal(target, tz).date
  return { kind: 'reply', text: `¿Reagendo tu cita de *${target.service_name}* del ${humanDate(origDate)} al ${when} a las ${formatLocalTime(newTime)}?` }
}

/** Recovers the appointment + validated new slot from OUR reschedule proposal. */
export function recoverRescheduleProposal(
  proposal: string, appts: ReadonlyArray<ActiveApptLite>,
  services: ReadonlyArray<ServiceLite>, wh: WorkingHours, tz: string, booked: ReadonlyArray<BookedSlot>,
): BookingTurn | null {
  const m = proposal.match(/reagendo tu cita de \*(.+?)\* del (.+?) al (.+?) a las (.+?)[?¿]/i)
  if (!m) return null
  const svc      = m[1]!.trim().toLowerCase()
  const origDate = parseDateExpression(m[2]!, todayInTimezone(tz), 'nearest')?.date
  const newDate  = parseDateExpression(m[3]!, todayInTimezone(tz), 'future')?.date
  const newTime  = extractTime(m[4]!)
  if (!newDate || !newTime) return null

  const cand   = appts.filter((a) => a.service_name?.toLowerCase().includes(svc) || svc.includes(a.service_name?.toLowerCase() ?? '\0'))
  const target = (origDate ? cand.find((a) => apptLocal(a, tz).date === origDate) : null) ?? (cand.length === 1 ? cand[0]! : null)
  if (!target) return null

  const dur = services.find((s) => s.name.toLowerCase() === (target.service_name?.toLowerCase() ?? ''))?.duration_min ?? 30
  const { open, slots } = computeAvailableSlots({ workingHours: wh, date: newDate, timezone: tz, durationMin: dur, bookedSlots: booked })
  if (!open || !slots.includes(newTime)) {
    return {
      kind: 'reply',
      text: slots.length > 0
        ? `Justo se ocupó ese horario. Para reagendar el ${humanDate(newDate)} me quedan: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
        : `Para el ${humanDate(newDate)} ya no queda horario libre para reagendar. ¿Probamos con otra fecha?`,
    }
  }
  return { kind: 'executeReschedule', appointmentId: target.id, serviceName: target.service_name, newDate, newTime }
}
