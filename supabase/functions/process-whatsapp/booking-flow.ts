/**
 * booking-flow.ts — Deterministic booking dispatcher (zero hallucination on writes).
 *
 * Thin entry point: routes a turn to the right deterministic sub-flow and returns an
 * execute directive, a verbatim reply (0 LLM tokens), or null (not a booking moment →
 * the LLM handles greeting/FAQ/clarification only). The real logic lives in:
 *   - booking-state.ts    → new-booking state machine (B) + gather + context
 *   - reschedule-flow.ts  → reschedule an existing appointment (C)
 *   - cancel-flow.ts      → cancel an existing appointment (C)
 *   - booking-shared.ts   → shared types/helpers/constants
 *
 * Anti-hallucination rule preserved: service/date/time come ONLY from the client's own
 * messages, never the assistant proposal; a "¿Confirmo…?" can ONLY be produced by code.
 *
 *   (A) Confirmation + "sí" on OUR proposal → EXECUTE (book/cancel/reschedule), re-validated.
 *   (B) In booking context → drive the new-booking sub-dialogue.
 *   (C) Cancel / reschedule of an EXISTING appointment.
 */

import { computeAvailableSlots, type WorkingHours, type BookedSlot } from './availability.ts'
import { lastAssistantWasConfirmation, isAffirmative } from './confirmation-gate.ts'
import { isCancelIntent, isRescheduleIntent } from './intents.ts'
import {
  type ServiceLite, type ActiveApptLite, type BookingTurn,
  OUR_RESCHEDULE_QUESTION_RE, apptLocal, humanDate, listFreeTimes,
} from './booking-shared.ts'
import { resolveCancelIntent, recoverCancelProposal } from './cancel-flow.ts'
import { resolveRescheduleTurn, recoverRescheduleProposal } from './reschedule-flow.ts'
import {
  OUR_BOOKING_PROPOSAL_RE, gatherBookingState, recoverProposedBooking,
  inBookingContext, resolveNewBookingTurn,
} from './booking-state.ts'

// Re-exported for callers/tests that imported it from here historically.
export { extractTime } from './datetime-nlu.ts'
export type { BookingTurn } from './booking-shared.ts'

// Cancel/reschedule proposals WE emit, recovered on the confirmation turn.
const OUR_CANCEL_PROPOSAL_RE     = /cancele\s+tu\s+cita\s+de/i
const OUR_RESCHEDULE_PROPOSAL_RE = /¿\s*reagendo\s+tu\s+cita\s+de/i

/** (A) On the affirmative confirmation turn, execute the recovered write. */
function resolveConfirmation(p: {
  userText: string
  history: ReadonlyArray<{ role: string; text: string }>
  lastAssistant: string
  services: ReadonlyArray<ServiceLite>
  workingHours: WorkingHours
  timezone: string
  bookedSlots: ReadonlyArray<BookedSlot>
  activeAppointments: ReadonlyArray<ActiveApptLite>
}): BookingTurn {
  const { userText, history, lastAssistant, services, workingHours, timezone, bookedSlots, activeAppointments } = p

  // (A.1) Cancel proposal → cancel_booking.
  if (OUR_CANCEL_PROPOSAL_RE.test(lastAssistant)) {
    const target = recoverCancelProposal(lastAssistant, activeAppointments, timezone)
    if (!target) return null
    const { date, time } = apptLocal(target, timezone)
    return { kind: 'executeCancel', appointmentId: target.id, serviceName: target.service_name, date, time }
  }
  // (A.2) Reschedule proposal → reschedule_booking.
  if (OUR_RESCHEDULE_PROPOSAL_RE.test(lastAssistant)) {
    return recoverRescheduleProposal(lastAssistant, activeAppointments, services, workingHours, timezone, bookedSlots)
  }
  // (A.3) New-booking proposal → confirm_booking, executing what the CLIENT said (gathered
  // from their own messages), NOT the proposal text. Falls back to the (deterministic)
  // proposal only if the client's stating turn fell out of the history window.
  if (OUR_BOOKING_PROPOSAL_RE.test(lastAssistant)) {
    const st = gatherBookingState(userText, history, services, timezone)
    let serviceId   = st.service?.id   ?? ''
    let serviceName = st.service?.name ?? ''
    let durationMin = st.service?.duration_min ?? 30
    let date        = st.date
    let time        = st.time
    if (!serviceId || !date || !time) {
      const rec = recoverProposedBooking(lastAssistant, services, timezone)
      if (rec) {
        serviceId   = serviceId   || rec.serviceId
        serviceName = serviceName || rec.serviceName
        durationMin = st.service?.duration_min ?? rec.durationMin
        date        = date || rec.date
        time        = time || rec.time
      }
    }
    if (!serviceId || !date || !time) return null // genuinely incomplete → LLM

    const { open, slots } = computeAvailableSlots({ workingHours, date, timezone, durationMin, bookedSlots })
    const when = humanDate(date)
    if (!open) {
      return { kind: 'reply', text: `Lo siento, el ${when} estamos cerrados. ¿Quieres que busquemos otra fecha?` }
    }
    if (!slots.includes(time)) {
      return { kind: 'reply', text: slots.length > 0
        ? `Justo se ocupó ese horario. Para el ${when} me quedan: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
        : `Para el ${when} ya no me queda ningún horario libre. ¿Probamos con otro día?` }
    }
    return { kind: 'execute', serviceId, serviceName, date, time }
  }

  // Affirmative but not on one of OUR proposals → let downstream handle.
  return null
}

/** Single deterministic entry point for a booking turn (see file header for A/B/C). */
export function resolveBookingTurn(p: {
  userText:     string
  history:      ReadonlyArray<{ role: string; text: string }>
  services:     ReadonlyArray<ServiceLite>
  workingHours: WorkingHours
  timezone:     string
  bookedSlots:  ReadonlyArray<BookedSlot>
  activeAppointments?: ReadonlyArray<ActiveApptLite>
  intent?:      string | null
}): BookingTurn {
  const { userText, history, services, workingHours, timezone, bookedSlots, intent } = p
  const activeAppointments = p.activeAppointments ?? []

  const lastAssistant = [...history].reverse()
    .find((h) => h.role === 'model' || h.role === 'assistant')?.text ?? ''

  // ── (A) Confirmation + affirmative → deterministic EXECUTE ──────────────────
  if (lastAssistantWasConfirmation(history) && isAffirmative(userText)) {
    return resolveConfirmation({ userText, history, lastAssistant, services, workingHours, timezone, bookedSlots, activeAppointments })
  }

  // ── (B) New-booking state machine — OWNS every booking-context turn ──────────
  if (inBookingContext(history, userText, intent ?? null)) {
    return resolveNewBookingTurn({ userText, history, services, workingHours, timezone, bookedSlots, lastAssistant })
  }

  // ── (C) Manage an EXISTING appointment (cancel / reschedule) ────────────────
  // Reschedule keyword OR a sticky reschedule sub-dialogue (we asked the new date/time)
  // → the deterministic reschedule resolver owns the turn (the LLM never proposes one).
  const inReschedule = OUR_RESCHEDULE_QUESTION_RE.test(lastAssistant)
  if (isRescheduleIntent(userText) || (inReschedule && !isCancelIntent(userText))) {
    return resolveRescheduleTurn({
      userText, history, appts: activeAppointments, services, wh: workingHours, tz: timezone, booked: bookedSlots,
    })
  }
  if (isCancelIntent(userText)) {
    return resolveCancelIntent(userText, activeAppointments, timezone)
  }

  return null
}
