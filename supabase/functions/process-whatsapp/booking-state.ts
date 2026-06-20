/**
 * booking-state.ts — New-booking state machine (anti-hallucination core).
 *
 * Reconstructs service/date/time from the client's OWN messages only (never an assistant
 * proposal a model could have invented), decides whether a turn belongs to a new booking,
 * and drives the service→day→time→propose sub-dialogue. The "¿Confirmo…?" proposal can
 * ONLY originate here.
 */

import { parseDateExpression } from './date-parser.ts'
import { parseDateTime, extractTime } from './datetime-nlu.ts'
import { formatLocalTime } from './prompt-builder.ts'
import { computeAvailableSlots, todayInTimezone, type WorkingHours, type BookedSlot } from './availability.ts'
import { isManageExisting, isBookIntent } from './intents.ts'
import {
  type ServiceLite, type ActiveApptLite, type BookingTurn,
  BOOKING_DONE_RE, OUR_RESCHEDULE_QUESTION_RE, foldText, humanDate, listFreeTimes,
} from './booking-shared.ts'

// A proposal WE generate always opens with this shape, so the confirmation turn can
// recover it deterministically (the LLM never executes).
export const OUR_BOOKING_PROPOSAL_RE = /¿\s*confirmo\s+tu\s+cita\s+de/i
// Our OWN booking questions — keep the flow "sticky" across sub-dialogue turns.
const OUR_BOOKING_QUESTION_RE = /(¿\s*confirmo\s+tu\s+cita|para\s+qu[ée]\s+d[íi]a|a\s+qu[ée]\s+hora|qu[ée]\s+servicio\s+deseas|te\s+agendo|horarios?\s+libres|estamos\s+cerrados)/i
// Our OWN messages that mean "the date is locked, choose the TIME" — so a bare number in
// the client's reply is an HOUR, not a day. NOT the combined "¿…día y a qué hora?".
const ASKING_TIME_RE = /(¿\s*a\s+qu[ée]\s+hora|no\s+tengo\s+disponible|no\s+te\s+entend[íi]\s+la\s+hora|¿\s*cu[áa]l\s+prefieres)/i
// A clear decline — avoids re-proposing the same slot after the client says no.
const NEGATIVE_RE = /^(no+|nop[ea]?|nel|para\s+nada|mejor\s+no|todav[íi]a\s+no|a[úu]n\s+no)\b/i

type HistoryTurn = { role: string; text: string }

/** ISO date in a proposal, or a Spanish expression. */
function parseDateFromProposal(text: string, today: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return parseDateExpression(text, today, 'future')?.date ?? null
}

/** Recovers the exact booking from a confirmation proposal we (or the LLM) emitted. */
export function recoverProposedBooking(
  proposal: string, services: ReadonlyArray<ServiceLite>, timezone: string,
): { serviceId: string; serviceName: string; date: string; time: string; durationMin: number } | null {
  const lower = proposal.toLowerCase()
  const svc = services.find((s) => s.name && lower.includes(s.name.toLowerCase()))
  if (!svc) return null
  const date = parseDateFromProposal(proposal, todayInTimezone(timezone))
  if (!date) return null
  const time = extractTime(proposal)
  if (!time) return null
  return { serviceId: svc.id, serviceName: svc.name, date, time, durationMin: svc.duration_min }
}

/** Service named in the text (substring either direction, min 3 chars for reverse).
 *  Accent-insensitive: "electronica" → "Electrónica". */
function serviceNamedIn(text: string, services: ReadonlyArray<ServiceLite>): ServiceLite | null {
  const t = foldText(text)
  if (!t) return null
  return services.find((s) => {
    const n = foldText(s.name)
    return !!n && (t.includes(n) || (t.length >= 3 && n.includes(t)))
  }) ?? null
}

/**
 * Reconstructs the booking the client has stated — service, date, time — scanning ONLY
 * the client's own messages (current first, then history newest→oldest). The most recent
 * stated value wins, so a correction overrides an earlier one. `expecting` only applies
 * to the CURRENT turn: if the agent just asked the time, a bare number there is the hour,
 * not a new day that would clobber the chosen date.
 */
export function gatherBookingState(
  userText: string,
  history: ReadonlyArray<HistoryTurn>,
  services: ReadonlyArray<ServiceLite>,
  timezone: string,
  expecting: 'time' | 'date' | null = null,
): { service: ServiceLite | null; date: string | null; time: string | null } {
  const today = todayInTimezone(timezone)
  // Gather ONLY from the CURRENT sub-dialogue: walk back and STOP at a prior completed
  // booking (assistant BOOKING_DONE) or the turn where THIS booking started (user
  // BOOK_INTENT — include it, then stop), so a stale earlier date never leaks in.
  const userTexts: string[] = [userText]
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h || !h.text) continue
    const isAssistant = h.role === 'model' || h.role === 'assistant'
    if (isAssistant && BOOKING_DONE_RE.test(h.text)) break
    if (h.role === 'user') {
      userTexts.push(h.text)
      if (isBookIntent(h.text)) break
    }
  }

  let service: ServiceLite | null = null
  for (const t of userTexts) { const s = serviceNamedIn(t, services); if (s) { service = s; break } }
  if (!service && services.length === 1) service = services[0]!

  let date: string | null = null
  let time: string | null = null
  for (let idx = 0; idx < userTexts.length; idx++) {
    const t  = userTexts[idx]!
    const dt = parseDateTime(t, today, idx === 0 && expecting ? { expecting } : {})
    if (!date && dt.date && dt.date >= today) date = dt.date
    if (!time && dt.time) time = dt.time
    if (date && time) break
  }

  return { service, date, time }
}

/** True when this turn belongs to a NEW-booking sub-dialogue the deterministic flow owns. */
export function inBookingContext(
  history: ReadonlyArray<HistoryTurn>, userText: string, intent: string | null,
): boolean {
  // Explicit cancel/reagendar → managed elsewhere, not new booking.
  if (isManageExisting(userText)) return false
  // Fresh booking signal on THIS turn always opens a (new) booking.
  if (intent === 'book_appointment') return true
  if (isBookIntent(userText)) return true

  const lastAssistant = [...history].reverse()
    .find((h) => h.role === 'model' || h.role === 'assistant')?.text ?? ''
  // A reschedule sub-dialogue is owned by the reschedule resolver, not new-booking.
  if (OUR_RESCHEDULE_QUESTION_RE.test(lastAssistant)) return false
  // Mid-flow: the prior assistant turn was one of OUR booking questions.
  if (OUR_BOOKING_QUESTION_RE.test(lastAssistant)) return true

  // Otherwise decide by the conversation boundary: a booking intent not yet completed
  // keeps context active; a COMPLETED booking (BOOKING_DONE) ends it.
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h || !h.text) continue
    const isAssistant = h.role === 'model' || h.role === 'assistant'
    if (isAssistant && BOOKING_DONE_RE.test(h.text)) return false
    if (h.role === 'user' && isBookIntent(h.text)) return true
  }
  return false
}

/**
 * New-booking sub-dialogue (state machine B): service → day → time → propose. Always
 * returns a reply or execute (never null) while in context; the LLM never invents or
 * proposes a date/time.
 */
export function resolveNewBookingTurn(p: {
  userText:     string
  history:      ReadonlyArray<HistoryTurn>
  services:     ReadonlyArray<ServiceLite>
  workingHours: WorkingHours
  timezone:     string
  bookedSlots:  ReadonlyArray<BookedSlot>
  lastAssistant: string
}): BookingTurn {
  const { userText, history, services, workingHours, timezone, bookedSlots, lastAssistant } = p

  // Explicit "no" to a pending proposal → ask what to change (never re-propose the same).
  if (NEGATIVE_RE.test(userText.trim()) && OUR_BOOKING_PROPOSAL_RE.test(lastAssistant)) {
    return { kind: 'reply', text: '¿Qué te gustaría cambiar: el servicio, el día o la hora?' }
  }

  // If the agent just asked the TIME (date already chosen), a bare number is the hour.
  const expecting: 'time' | null = ASKING_TIME_RE.test(lastAssistant) ? 'time' : null
  const st = gatherBookingState(userText, history, services, timezone, expecting)

  if (!st.service) {
    const names = services.map((s) => s.name).join(', ')
    return { kind: 'reply', text: names
      ? `Con gusto te ayudo a agendar. ¿Qué servicio deseas? Tenemos: ${names}.`
      : 'Con gusto te ayudo a agendar. ¿Qué servicio deseas?' }
  }

  const askedDay   = /(para\s+qu[ée]\s+d[íi]a|d[íi]a\s+y\s+a\s+qu[ée]\s+hora)/i.test(lastAssistant)
  const askedTime  = /(a\s+qu[ée]\s+hora|horarios?\s+libres)/i.test(lastAssistant)
  const saidNow    = parseDateTime(userText, todayInTimezone(timezone), expecting ? { expecting } : {})
  const hasContent = userText.trim().length > 0

  // "No entendí la fecha": asked the day and the reply parsed to nothing → give examples.
  if (!st.date && askedDay && hasContent && !saidNow.date) {
    return { kind: 'reply', text: `No te entendí la fecha 🙏. Puedes decir, por ejemplo, *mañana*, *el 21* o *el lunes*. ¿Para qué día quieres tu cita de *${st.service.name}*?` }
  }
  if (!st.date && !st.time) {
    return { kind: 'reply', text: `Con gusto te agendo *${st.service.name}*. ¿Para qué día y a qué hora te gustaría?` }
  }
  if (!st.date) {
    return { kind: 'reply', text: `¿Para qué día quieres tu cita de *${st.service.name}*?` }
  }

  const { open, slots } = computeAvailableSlots({ workingHours, date: st.date, timezone, durationMin: st.service.duration_min, bookedSlots })
  const when = humanDate(st.date)
  if (!open) {
    return { kind: 'reply', text: `Lo siento, el ${when} estamos cerrados. ¿Quieres que busquemos otra fecha?` }
  }
  if (!st.time) {
    // Only scold "no entendí la hora" if the client attempted a time that failed to parse
    // — NOT when they just gave the day (saidNow.date present), which is normal progress.
    if (askedTime && hasContent && !saidNow.time && !saidNow.date && slots.length > 0) {
      return { kind: 'reply', text: `No te entendí la hora 🙏. Puedes decir *a las 3*, *11 am* o *15:30*. Para el ${when} tengo: ${listFreeTimes(slots)}. ¿A qué hora?` }
    }
    return { kind: 'reply', text: slots.length > 0
      ? `Para el ${when} tengo estos horarios libres para *${st.service.name}*: ${listFreeTimes(slots)}. ¿A qué hora te viene bien?`
      : `Para el ${when} no me queda ningún horario libre para *${st.service.name}*. ¿Probamos con otro día?` }
  }
  if (!slots.includes(st.time)) {
    return { kind: 'reply', text: slots.length > 0
      ? `A las ${formatLocalTime(st.time)} no tengo disponible el ${when}. Horarios libres para *${st.service.name}*: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
      : `Para el ${when} no me queda ningún horario libre para *${st.service.name}*. ¿Probamos con otro día?` }
  }
  // service + date + valid time → the ONLY source of a booking proposal.
  return { kind: 'reply', text: `¿Confirmo tu cita de *${st.service.name}* para el ${when} a las ${formatLocalTime(st.time)}?` }
}
