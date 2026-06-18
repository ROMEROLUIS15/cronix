/**
 * booking-flow.ts — Deterministic booking state machine for the WhatsApp agent.
 *
 * GOAL: zero hallucination on the booking WRITE path. The 8B model never emits
 * service_id / date / time, and never *proposes* a time. All three are extracted
 * and validated deterministically from the conversation + the loaded catalog +
 * real availability. The LLM remains only for free chat / gathering when the turn
 * is ambiguous (resolveBookingTurn returns null → caller falls through to the LLM).
 *
 * Two deterministic moments:
 *   (A) Confirmation turn → EXECUTE. When the prior assistant turn was OUR booking
 *       proposal ("¿Confirmo tu cita de … para el … a las …?") and the user said
 *       "sí", we recover the exact booking from that proposal, re-validate the slot
 *       is still free, and return an `execute` directive. confirm_booking is run by
 *       code, not by a tool-call the model chose.
 *   (B) Proposal turn → REPLY. When the client gives service + date + (maybe time)
 *       in a booking context, we validate against working hours + booked slots and
 *       reply with a deterministic confirmation question (or list real free times).
 *
 * Anything outside this happy path (ambiguous service, cancel/reschedule, missing
 * date) returns null and the existing LLM loop / deterministic intent fallback
 * handles it. This module is additive: it shrinks the LLM's authority, the gate
 * and adapter validation remain as defence in depth for the fallback path.
 */

import { parseDateExpression } from './date-parser.ts'
import { formatLocalTime }     from './prompt-builder.ts'
import {
  computeAvailableSlots,
  todayInTimezone,
  type WorkingHours,
  type BookedSlot,
} from './availability.ts'
import { lastAssistantWasConfirmation, isAffirmative } from './confirmation-gate.ts'

const MAX_LISTED = 8

type ServiceLite = { id: string; name: string; duration_min: number }

export type BookingTurn =
  | { kind: 'reply';   text: string }
  | { kind: 'execute'; serviceId: string; serviceName: string; date: string; time: string }
  | null

// Shared with availability.ts — a booking proposal we generate always opens with
// this shape, so the confirmation turn can recover it deterministically.
const OUR_BOOKING_PROPOSAL_RE = /¿\s*confirmo\s+tu\s+cita\s+de/i

const CANCEL_RE     = /\b(cancel(?:a|ar|o|en|ame|alo)?|anul(?:a|ar)?|borrar?)\b/i
const RESCHEDULE_RE = /\b(reagend(?:a|ar|ame|alo)?|reprogram(?:a|ar|ame)?|mover|mueve|cambia(?:r)?)\b/i

function humanDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** Picks the service to act on: the only one in the catalog, or one named in text. */
function resolveService(text: string, services: ReadonlyArray<ServiceLite>): ServiceLite | null {
  if (services.length === 1) return services[0]!
  const t = text.toLowerCase()
  return services.find((s) => s.name && t.includes(s.name.toLowerCase())) ?? null
}

/**
 * Extracts an explicit clock time from free text and normalises to 24h HH:mm.
 * Returns null when the text carries no time the client actually stated — we
 * never guess one. Handles: "13:00", "9:00 am", "1 pm", "a las 9", "9 de la noche".
 */
export function extractTime(text: string): string | null {
  const t = text.toLowerCase()

  // HH:mm, optionally followed by am/pm.
  let m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/)
  if (m) {
    let h = parseInt(m[1]!, 10)
    const min = m[2]!
    const ap  = (m[3] ?? '').replace(/[.\s]/g, '')
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h <= 23) return `${pad2(h)}:${min}`
  }

  // "a las 9", "para las 9", "9 am", "9 pm", "9 de la mañana/tarde/noche".
  m = t.match(/\b(?:a\s+las?|para\s+las?)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/)
    ?? t.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|de\s+la\s+(?:ma[nñ]ana|tarde|noche))\b/)
  if (m) {
    let h = parseInt(m[1]!, 10)
    const min  = m[2] ?? '00'
    const tail = (m[3] ?? '').replace(/[.\s]/g, '')
    const isPm = tail.startsWith('p') || /tarde|noche/.test(tail)
    const isAm = tail.startsWith('a') || /manana|mañana/.test(tail)
    if (isPm && h < 12) h += 12
    if (isAm && h === 12) h = 0
    if (h <= 23) return `${pad2(h)}:${min}`
  }

  return null
}

/** ISO date in our (or the LLM's) proposal, or a Spanish expression. */
function parseDateFromProposal(text: string, today: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return parseDateExpression(text, today, 'future')?.date ?? null
}

/** Recovers the exact booking from a confirmation proposal we (or the LLM) emitted. */
function recoverProposedBooking(
  proposal: string,
  services: ReadonlyArray<ServiceLite>,
  timezone: string,
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

function listFreeTimes(slots: string[]): string {
  const list = slots.slice(0, MAX_LISTED).map(formatLocalTime).join(', ')
  return slots.length > MAX_LISTED ? `${list}, entre otros` : list
}

/**
 * Single deterministic entry point for a booking turn. Returns:
 *   - { kind:'execute' } → caller runs confirm_booking with these exact, validated args.
 *   - { kind:'reply' }   → caller sends this text verbatim (0 LLM tokens).
 *   - null               → not a deterministic booking moment; fall through to the LLM.
 */
export function resolveBookingTurn(p: {
  userText:     string
  history:      ReadonlyArray<{ role: string; text: string }>
  services:     ReadonlyArray<ServiceLite>
  workingHours: WorkingHours
  timezone:     string
  bookedSlots:  ReadonlyArray<BookedSlot>
  intent?:      string | null
}): BookingTurn {
  const { userText, history, services, workingHours, timezone, bookedSlots, intent } = p

  const lastAssistant = [...history].reverse()
    .find((h) => h.role === 'model' || h.role === 'assistant')?.text ?? ''

  // ── (A) Confirmation → deterministic execute ────────────────────────────────
  if (lastAssistantWasConfirmation(history) && isAffirmative(userText)) {
    // Only OUR new-booking proposals execute here. Cancel/reschedule confirmations
    // (different proposal shapes) fall through to the existing path.
    if (!OUR_BOOKING_PROPOSAL_RE.test(lastAssistant)) return null

    const recovered = recoverProposedBooking(lastAssistant, services, timezone)
    if (!recovered) return null // couldn't recover → let the LLM path handle it

    // Re-validate the slot is still bookable at execution time (defence vs a slot
    // taken between proposal and confirmation, or an out-of-hours proposal).
    const { open, slots } = computeAvailableSlots({
      workingHours, date: recovered.date, timezone, durationMin: recovered.durationMin, bookedSlots,
    })
    const when = humanDate(recovered.date)
    if (!open) {
      return { kind: 'reply', text: `Lo siento, el ${when} estamos cerrados. ¿Quieres que busquemos otra fecha?` }
    }
    if (!slots.includes(recovered.time)) {
      return {
        kind: 'reply',
        text: slots.length > 0
          ? `Justo se ocupó ese horario. Para el ${when} me quedan: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
          : `Para el ${when} ya no me queda ningún horario libre. ¿Probamos con otro día?`,
      }
    }
    return {
      kind:        'execute',
      serviceId:   recovered.serviceId,
      serviceName: recovered.serviceName,
      date:        recovered.date,
      time:        recovered.time,
    }
  }

  // ── Booking context gate for the proposal branch ────────────────────────────
  const isBookingContext =
    intent === 'book_appointment' ||
    /¿\s*(te\s+gustar[íi]a\s+agendar|quieres\s+agendar|deseas\s+agendar|agendamos|a\s+qu[ée]\s+hora)/i.test(lastAssistant)
  if (!isBookingContext) return null
  if (CANCEL_RE.test(userText) || RESCHEDULE_RE.test(userText)) return null

  const today  = todayInTimezone(timezone)
  const service = resolveService(userText, services)
  const parsed  = parseDateExpression(userText, today, 'future')
  const time    = extractTime(userText)

  // ── (B) service + date + time → validated deterministic proposal ────────────
  if (service && parsed && parsed.date >= today && time) {
    const { open, slots } = computeAvailableSlots({
      workingHours, date: parsed.date, timezone, durationMin: service.duration_min, bookedSlots,
    })
    const when = humanDate(parsed.date)
    if (!open) {
      return { kind: 'reply', text: `Lo siento, el ${when} estamos cerrados. ¿Quieres que busquemos otra fecha?` }
    }
    if (!slots.includes(time)) {
      return {
        kind: 'reply',
        text: slots.length > 0
          ? `A las ${formatLocalTime(time)} no tengo disponible el ${when}. Horarios libres para *${service.name}*: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
          : `Para el ${when} no me queda ningún horario libre para *${service.name}*. ¿Probamos con otro día?`,
      }
    }
    return {
      kind: 'reply',
      text: `¿Confirmo tu cita de *${service.name}* para el ${when} a las ${formatLocalTime(time)}?`,
    }
  }

  // Anything else (date without time, missing service, etc.) is handled by the
  // existing resolveBookingTimeGap layer and the LLM fallback in ai-agent.ts.
  return null
}
