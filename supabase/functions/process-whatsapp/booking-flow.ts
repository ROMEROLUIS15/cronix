/**
 * booking-flow.ts — Deterministic booking state machine for the WhatsApp agent.
 *
 * GOAL: zero hallucination on the booking path. Once booking is in play, this
 * deterministic state machine OWNS every turn of the sub-dialogue — the LLM never
 * emits service_id/date/time and never *proposes* a date or time. A confirmation
 * question ("¿Confirmo tu cita de … para el … a las …?") can ONLY be produced here.
 *
 * Core anti-hallucination rule: service/date/time are gathered ONLY from the
 * client's OWN messages (gatherBookingState), never from an assistant proposal
 * (which a model could have invented). The most recent client-stated value wins, so
 * a correction overrides an earlier one. On the confirmation turn we EXECUTE what
 * the client said — not the proposal text — so an invented date can never be booked.
 *
 * Turn handling (resolveBookingTurn):
 *   (A) Confirmation + "sí" on OUR proposal → EXECUTE (book/cancel/reschedule),
 *       re-validating the slot. Booking executes the gathered client state.
 *   (B) In booking context → drive the sub-dialogue: ask service → ask day → offer
 *       real free times → propose. Always replies/executes (never null).
 *   (C) Cancel / reschedule of an EXISTING appointment.
 *   else → null (not a booking moment) → LLM handles greeting/FAQ/clarification only.
 */

import { parseDateExpression } from './date-parser.ts'
import { parseDateTime, extractTime } from './datetime-nlu.ts'
import { formatLocalTime }     from './prompt-builder.ts'
import {
  computeAvailableSlots,
  todayInTimezone,
  type WorkingHours,
  type BookedSlot,
} from './availability.ts'
import { lastAssistantWasConfirmation, isAffirmative } from './confirmation-gate.ts'
import { utcToLocalParts } from './time-utils.ts'

// Re-exported for callers/tests that imported it from here historically.
export { extractTime }

const MAX_LISTED = 8

type ServiceLite    = { id: string; name: string; duration_min: number }
type ActiveApptLite = { id: string; service_name: string; start_at: string }

export type BookingTurn =
  | { kind: 'reply';   text: string }
  | { kind: 'execute';           serviceId: string;     serviceName: string; date: string;    time: string }
  | { kind: 'executeCancel';     appointmentId: string; serviceName: string; date: string;    time: string }
  | { kind: 'executeReschedule'; appointmentId: string; serviceName: string; newDate: string; newTime: string }
  | null

// A proposal WE generate always opens with one of these shapes, so the
// confirmation turn can recover it deterministically (the LLM never executes).
const OUR_BOOKING_PROPOSAL_RE     = /¿\s*confirmo\s+tu\s+cita\s+de/i
const OUR_CANCEL_PROPOSAL_RE      = /cancele\s+tu\s+cita\s+de/i
const OUR_RESCHEDULE_PROPOSAL_RE  = /¿\s*reagendo\s+tu\s+cita\s+de/i

// Verb stems use \w* so enclitic/inflected forms match too: "reagéndala",
// "reagendarla", "cancélala", "reprográmame" (the bare \b...\b suffix list missed
// the attached pronoun and dropped the turn to the LLM, which never executed).
const CANCEL_RE     = /\b(cancel\w*|anul\w*|borr\w*)\b/i
const RESCHEDULE_RE = /\b(reagend\w*|reprogram\w*|mover|mueve|cambi\w*)\b/i

// "Manage an EXISTING appointment" — cancel/reagendar explicitly. Exits new-booking
// context (NOT the ambiguous "cambia/mover", which mid-booking means "change the proposal").
const MANAGE_EXISTING_RE = /\b(cancel\w*|anul\w*|reagend\w*|reprogram\w*)\b/i
// Fresh new-booking intent. \bagend does NOT match "reagendar" (no word boundary), so
// reschedule isn't mistaken for a new booking.
const BOOK_INTENT_RE = /\b(agend(?:a|ar|ame|alo|emos|o)?|reserv(?:a|ar|ame|o)?|(?:quiero|necesito|sacar|pedir|dame|hacer)\s+(?:una\s+)?cita|nueva\s+cita)\b/i
// Our OWN booking questions/proposals — keeps the flow "sticky" across sub-dialogue turns.
const OUR_BOOKING_QUESTION_RE = /(¿\s*confirmo\s+tu\s+cita|para\s+qu[ée]\s+d[íi]a|a\s+qu[ée]\s+hora|qu[ée]\s+servicio\s+deseas|te\s+agendo|horarios?\s+libres|estamos\s+cerrados)/i
// A completed/closed booking — ends booking context so we don't re-propose.
const BOOKING_DONE_RE = /(qued[óo]\s+agendada|cita\s+reagendada|ha\s+sido\s+cancelada|listo!\s)/i
// Our OWN reschedule questions/proposal — keep the reschedule sub-dialogue sticky
// across turns and out of the new-booking state machine (its time question overlaps
// OUR_BOOKING_QUESTION_RE's "a qué hora").
const OUR_RESCHEDULE_QUESTION_RE =
  /(nueva\s+fecha\s+quieres\s+reagendar|hora\s+quieres\s+tu\s+cita|cu[áa]l\s+deseas\s+reagendar|¿\s*reagendo\s+tu\s+cita)/i
// "a la misma hora" / "el mismo horario" → keep the appointment's current time.
const SAME_HOUR_RE = /\b(?:a\s+la\s+)?misma\s+hora\b|\bmismo\s+horario\b|\bigual\s+(?:hora|horario)\b/i
// A clear decline — used to avoid re-proposing the same slot after the client says no.
const NEGATIVE_RE = /^(no+|nop[ea]?|nel|para\s+nada|mejor\s+no|todav[íi]a\s+no|a[úu]n\s+no)\b/i

function humanDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
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

// ── Cancel / reschedule helpers (deterministic identification) ─────────────────

function apptLocal(a: ActiveApptLite, tz: string): { date: string; time: string } {
  return utcToLocalParts(a.start_at, tz)
}

/** Narrows active appointments by the service and/or date named in the text. */
function matchAppointments(
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

function listActiveAppointments(
  appts: ReadonlyArray<ActiveApptLite>, tz: string, verb: 'cancelar' | 'reagendar',
): string {
  const list = appts.slice(0, 5).map((a, i) => {
    const { date, time } = apptLocal(a, tz)
    return `${i + 1}. *${a.service_name}* — ${humanDate(date)} a las ${formatLocalTime(time)}`
  }).join('\n')
  return `Tienes varias citas activas:\n\n${list}\n\n¿Cuál deseas ${verb}?`
}

/** Cancel intent → identify the appointment and propose the confirmation. */
function resolveCancelIntent(
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
function recoverCancelProposal(
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

/** Client texts that belong to the CURRENT reschedule sub-dialogue (newest→trigger). */
function rescheduleSubDialogueTexts(
  userText: string, history: ReadonlyArray<{ role: string; text: string }>,
): string[] {
  // The trigger turn itself starts (and bounds) the sub-dialogue.
  if (RESCHEDULE_RE.test(userText)) return [userText]
  const texts = [userText]
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h || !h.text) continue
    if (h.role !== 'user' && BOOKING_DONE_RE.test(h.text)) break
    if (h.role === 'user') {
      texts.push(h.text)
      if (RESCHEDULE_RE.test(h.text)) break
    }
  }
  return texts
}

/**
 * Reschedule of an EXISTING appointment — deterministic and multi-turn. Identifies the
 * target, gathers the NEW date/time across the whole reschedule sub-dialogue (supporting
 * "a la misma hora" → the appointment's current time), validates the slot and proposes.
 * The LLM never proposes a reschedule (anti-hallucination): this is the ONLY source of
 * "¿Reagendo tu cita…?", so the confirmation "sí" can always be recovered and executed.
 */
function resolveRescheduleTurn(p: {
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
  if (!newTime) return { kind: 'reply', text: `¿A qué hora quieres tu cita de *${target.service_name}* el ${humanDate(newDate)}?` }

  const dur = services.find((s) => s.name.toLowerCase() === target.service_name.toLowerCase())?.duration_min ?? 30
  const { open, slots } = computeAvailableSlots({ workingHours: wh, date: newDate, timezone: tz, durationMin: dur, bookedSlots: booked })
  const when = humanDate(newDate)
  if (!open) return { kind: 'reply', text: `Lo siento, el ${when} estamos cerrados. ¿Quieres otra fecha?` }
  if (!slots.includes(newTime)) {
    return {
      kind: 'reply',
      text: slots.length > 0
        ? `A las ${formatLocalTime(newTime)} no tengo disponible el ${when}. Horarios libres: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
        : `Para el ${when} no me queda ningún horario libre. ¿Probamos con otro día?`,
    }
  }
  const origDate = apptLocal(target, tz).date
  return { kind: 'reply', text: `¿Reagendo tu cita de *${target.service_name}* del ${humanDate(origDate)} al ${when} a las ${formatLocalTime(newTime)}?` }
}

/** Recovers the appointment + validated new slot from OUR reschedule proposal. */
function recoverRescheduleProposal(
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
        ? `Justo se ocupó ese horario. El ${humanDate(newDate)} me quedan: ${listFreeTimes(slots)}. ¿Cuál prefieres?`
        : `Para el ${humanDate(newDate)} ya no me queda ningún horario libre. ¿Probamos con otro día?`,
    }
  }
  return { kind: 'executeReschedule', appointmentId: target.id, serviceName: target.service_name, newDate, newTime }
}

// ── New-booking session state (reconstructed from the client's OWN messages) ────

/** Lowercase + strip accents so "electronica" matches the service "Electrónica". */
function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
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
 * Reconstructs the booking the client has stated — service, date, time — scanning
 * ONLY the client's own messages (current first, then history newest→oldest). This
 * is the anti-hallucination core: we never read date/time from an assistant proposal
 * (which the LLM could have invented). The most recent client-stated value wins, so a
 * correction ("mejor el martes") overrides an earlier one. Service falls back to the
 * single catalog entry. Returns nulls for whatever the client hasn't said yet.
 */
function gatherBookingState(
  userText: string,
  history: ReadonlyArray<{ role: string; text: string }>,
  services: ReadonlyArray<ServiceLite>,
  timezone: string,
): { service: ServiceLite | null; date: string | null; time: string | null } {
  const today = todayInTimezone(timezone)
  // CRITICAL: gather ONLY from the CURRENT booking sub-dialogue. The history window
  // spans previous conversations/bookings, so reading the whole thing pulls a stale
  // date/time the client stated in an EARLIER booking and re-proposes it now. Walk
  // back from the newest turn and STOP at the boundary of this sub-dialogue: a prior
  // completed booking (assistant BOOKING_DONE), or the turn where THIS booking
  // started (a user BOOK_INTENT message — include it, then stop).
  const userTexts: string[] = [userText]
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h || !h.text) continue
    const isAssistant = h.role === 'model' || h.role === 'assistant'
    if (isAssistant && BOOKING_DONE_RE.test(h.text)) break
    if (h.role === 'user') {
      userTexts.push(h.text)
      if (BOOK_INTENT_RE.test(h.text)) break
    }
  }

  let service: ServiceLite | null = null
  for (const t of userTexts) { const s = serviceNamedIn(t, services); if (s) { service = s; break } }
  if (!service && services.length === 1) service = services[0]!

  // Combined NLU per turn (parses time, strips it, then the date) so "21 a las 11"
  // yields day 21 + 11:00 in one shot. Most recent stated value wins (newest-first).
  let date: string | null = null
  let time: string | null = null
  for (const t of userTexts) {
    const dt = parseDateTime(t, today)
    if (!date && dt.date && dt.date >= today) date = dt.date
    if (!time && dt.time) time = dt.time
    if (date && time) break
  }

  return { service, date, time }
}

/** True when this turn belongs to a NEW-booking sub-dialogue the deterministic flow owns. */
function inBookingContext(
  history: ReadonlyArray<{ role: string; text: string }>,
  userText: string,
  intent: string | null,
): boolean {
  // Explicit cancel/reagendar → managed elsewhere, not new booking.
  if (MANAGE_EXISTING_RE.test(userText)) return false

  // Fresh booking signal on THIS turn always opens a (new) booking.
  if (intent === 'book_appointment') return true
  if (BOOK_INTENT_RE.test(userText)) return true

  const lastAssistant = [...history].reverse()
    .find((h) => h.role === 'model' || h.role === 'assistant')?.text ?? ''
  // A reschedule sub-dialogue is owned by the reschedule resolver, not the new-booking
  // machine — its time question "¿A qué hora quieres tu cita…?" overlaps OUR_BOOKING_QUESTION_RE.
  if (OUR_RESCHEDULE_QUESTION_RE.test(lastAssistant)) return false
  // Mid-flow: the prior assistant turn was one of OUR booking questions.
  if (OUR_BOOKING_QUESTION_RE.test(lastAssistant)) return true

  // Otherwise decide by the conversation boundary: walk back from the newest turn —
  // a booking intent that hasn't been completed yet keeps the context active, but a
  // COMPLETED booking (BOOKING_DONE) ends it. This stops a finished booking from
  // making an unrelated later message ("¿tengo citas?", "gracias") look like a new one.
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h || !h.text) continue
    const isAssistant = h.role === 'model' || h.role === 'assistant'
    if (isAssistant && BOOKING_DONE_RE.test(h.text)) return false
    if (h.role === 'user' && BOOK_INTENT_RE.test(h.text)) return true
  }
  return false
}

/**
 * Single deterministic entry point for a booking turn. Returns:
 *   - { kind:'execute*' } → caller runs the write with these exact, validated args.
 *   - { kind:'reply' }    → caller sends this text verbatim (0 LLM tokens).
 *   - null                → not a deterministic moment; fall through to the LLM.
 */
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
    // (A.3) New-booking proposal → confirm_booking, executing what the CLIENT said
    // (gathered from their own messages), NOT the proposal text. Anti-hallucination:
    // if the proposal had an invented date but the client stated another, the client's
    // wins. Falls back to the (deterministic) proposal only if the client's stating
    // turn fell out of the history window.
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

  // ── (B) New-booking state machine — OWNS every booking-context turn ──────────
  // Once booking is in play, the deterministic flow handles the whole sub-dialogue
  // (service → date → time → propose), so the LLM never invents or proposes a
  // date/time. Always returns a reply or execute (never null) while in context.
  if (inBookingContext(history, userText, intent ?? null)) {
    // Explicit "no" to a pending proposal → ask what to change (never re-propose the same).
    if (NEGATIVE_RE.test(userText.trim()) && OUR_BOOKING_PROPOSAL_RE.test(lastAssistant)) {
      return { kind: 'reply', text: '¿Qué te gustaría cambiar: el servicio, el día o la hora?' }
    }

    const st = gatherBookingState(userText, history, services, timezone)

    if (!st.service) {
      const names = services.map((s) => s.name).join(', ')
      return { kind: 'reply', text: names
        ? `Con gusto te ayudo a agendar. ¿Qué servicio deseas? Tenemos: ${names}.`
        : 'Con gusto te ayudo a agendar. ¿Qué servicio deseas?' }
    }

    // "No entendí": detect when we already asked for the day/time and the client's reply
    // didn't parse, so we give examples instead of repeating the same question (no loop).
    const askedDay   = /(para\s+qu[ée]\s+d[íi]a|d[íi]a\s+y\s+a\s+qu[ée]\s+hora)/i.test(lastAssistant)
    const askedTime  = /(a\s+qu[ée]\s+hora|horarios?\s+libres)/i.test(lastAssistant)
    const saidNow    = parseDateTime(userText, todayInTimezone(timezone))
    const hasContent = userText.trim().length > 0

    // "No entendí la fecha": we already asked for the day and the reply parsed to nothing
    // → give examples (never repeat the same question = no robotic loop).
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
      if (askedTime && hasContent && !saidNow.time && slots.length > 0) {
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

  // ── (C) Manage an EXISTING appointment (cancel / reschedule) ────────────────
  // Reschedule keyword OR a sticky reschedule sub-dialogue (we asked the new date/time)
  // → the deterministic reschedule resolver owns the turn (the LLM never proposes one).
  const inReschedule = OUR_RESCHEDULE_QUESTION_RE.test(lastAssistant)
  if (RESCHEDULE_RE.test(userText) || (inReschedule && !CANCEL_RE.test(userText))) {
    return resolveRescheduleTurn({
      userText, history, appts: activeAppointments, services, wh: workingHours, tz: timezone, booked: bookedSlots,
    })
  }
  if (CANCEL_RE.test(userText)) {
    return resolveCancelIntent(userText, activeAppointments, timezone)
  }

  return null
}
