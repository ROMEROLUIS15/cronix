/**
 * availability.ts — Deterministic slot resolver for the WhatsApp agent.
 *
 * Purpose: kill the "invented time" hallucination. When the client gives a date
 * but no time, the 8B used to fabricate one (e.g. "3:00 PM"). Instead we compute
 * the REAL free slots from working_hours + already-booked slots + service
 * duration, with ZERO LLM tokens, and either:
 *   - 0 free  → tell them the day is full / closed and ask for another date,
 *   - 1 free  → propose that exact slot as a confirmation question,
 *   - many    → list them and ask which one — never guessing.
 *
 * `computeAvailableSlots` mirrors voice-worker/capabilities/available-slots but
 * operates on the bookedSlots already in BusinessRagContext (no extra query).
 */

import { parseDateExpression } from './date-parser.ts'
import { formatLocalTime }     from './prompt-builder.ts'

/**
 * Business working hours as stored by the dashboard (settings.workingHours):
 *   - keys are 3-letter lowercase weekdays: mon|tue|wed|thu|fri|sat|sun
 *   - value is [open, close] (e.g. ["09:00","18:00"]) for an open day, or null
 *     when the day is closed/inactive.
 * The agent reads THIS shape (the dashboard is the source of truth). When the
 * object is absent/empty (never configured) the resolver defaults to 09:00–18:00.
 */
export type WorkingHours = Record<string, [string, string] | null> | null | undefined
export type BookedSlot   = { start_at: string; end_at: string }
type ServiceLite         = { id: string; name: string; duration_min: number }

const SLOT_INTERVAL = 30
const MAX_LISTED    = 8

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** Local 'YYYY-MM-DD' for the business "today". */
export function todayInTimezone(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
}

/** Local date+time (HH:mm) → UTC ISO. Same Intl algorithm as booking-adapter. */
function localToUTC(date: string, time: string, timezone: string): string {
  const naiveAsUTC = new Date(`${date}T${time}:00Z`)
  const tzStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(naiveAsUTC)
  const tzAsUTC = new Date(tzStr.replace(' ', 'T') + 'Z')
  return new Date(naiveAsUTC.getTime() + (naiveAsUTC.getTime() - tzAsUTC.getTime())).toISOString()
}

export interface DayAvailability {
  /** false = business closed that weekday (explicit null in working_hours). */
  open:  boolean
  /** Free start times as local 'HH:mm', in ascending order. */
  slots: string[]
}

/**
 * Computes the free start times for a service on a given local date.
 * Pure: no I/O, no LLM. Defaults to 09:00–18:00 when working_hours is absent.
 */
export function computeAvailableSlots(p: {
  workingHours: WorkingHours
  date:         string
  timezone:     string
  durationMin:  number
  bookedSlots:  ReadonlyArray<BookedSlot>
}): DayAvailability {
  const { workingHours, date, timezone, durationMin, bookedSlots } = p
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !durationMin || durationMin < 5) {
    return { open: false, slots: [] }
  }

  // Dashboard day keys are 3-letter lowercase (mon/tue/.../sun). Intl 'long'
  // weekday sliced to 3 chars yields exactly those (monday→mon, wednesday→wed…).
  const dayKey = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone })
    .format(new Date(`${date}T12:00:00Z`)).toLowerCase().slice(0, 3)

  const configured = !!workingHours && Object.keys(workingHours).length > 0
  let open  = '09:00'
  let close = '18:00'
  if (configured) {
    const wh = workingHours![dayKey]
    // Closed day: key absent or explicitly null.
    if (!wh || !Array.isArray(wh) || wh.length < 2) return { open: false, slots: [] }
    open  = wh[0]
    close = wh[1]
  }
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)
  if ([oh, om, ch, cm].some((n) => n === undefined || Number.isNaN(n))) return { open: true, slots: [] }

  const openMin  = oh! * 60 + om!
  const closeMin = ch! * 60 + cm!

  const free: string[] = []
  // Invariant: the service must END by closing time.
  for (let t = openMin; t + durationMin <= closeMin; t += SLOT_INTERVAL) {
    const candidate = `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`
    const startMs   = new Date(localToUTC(date, candidate, timezone)).getTime()
    const endMs     = startMs + durationMin * 60_000
    const conflict  = bookedSlots.some((b) =>
      new Date(b.start_at).getTime() < endMs && new Date(b.end_at).getTime() > startMs
    )
    if (!conflict) free.push(candidate)
  }
  return { open: true, slots: free }
}

// ── Time-presence detector ────────────────────────────────────────────────────

/** True when the text already carries an explicit time the client chose. */
export function textHasTime(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b([01]?\d|2[0-3]):[0-5]\d\b/.test(t)) return true
  if (/\b(a\s+las?|para\s+las?)\s+\d{1,2}\b/.test(t)) return true
  if (/\b\d{1,2}\s*(?:am|pm|h)\b/i.test(t)) return true
  if (/\b\d{1,2}\s+de\s+la\s+(?:mañana|manana|tarde|noche)\b/i.test(t)) return true
  return false
}

// ── Deterministic booking-gap resolver ────────────────────────────────────────

const CANCEL_RE     = /\b(cancel(?:a|ar|o|en|ame|alo)?|anul(?:a|ar)?|borrar?)\b/i
const RESCHEDULE_RE = /\b(reagend(?:a|ar|ame|alo)?|reprogram(?:a|ar|ame)?|mover|mueve|cambia(?:r)?)\b/i

function humanDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** Picks the service to quote a time for: the only one, or one named in the text. */
function resolveService(userText: string, services: ReadonlyArray<ServiceLite>): ServiceLite | null {
  if (services.length === 1) return services[0]!
  const t = userText.toLowerCase()
  return services.find((s) => t.includes(s.name.toLowerCase())) ?? null
}

/**
 * Returns a deterministic reply (0 LLM tokens) ONLY when the client is booking,
 * gave a recognisable date, gave NO time, and the service is unambiguous.
 * Otherwise returns null and the caller falls through to the LLM.
 */
export function resolveBookingTimeGap(p: {
  userText:         string
  /** True when the turn is clearly about booking (intent OR prior assistant offer/confirm). */
  isBookingContext: boolean
  services:         ReadonlyArray<ServiceLite>
  workingHours:     WorkingHours
  timezone:         string
  bookedSlots:      ReadonlyArray<BookedSlot>
}): string | null {
  const { userText, isBookingContext, services, workingHours, timezone, bookedSlots } = p

  if (!isBookingContext) return null
  if (CANCEL_RE.test(userText) || RESCHEDULE_RE.test(userText)) return null
  if (textHasTime(userText)) return null

  const today  = todayInTimezone(timezone)
  const parsed = parseDateExpression(userText, today, 'future')
  if (!parsed || parsed.date < today) return null

  const service = resolveService(userText, services)
  if (!service) return null

  const { open, slots } = computeAvailableSlots({
    workingHours, date: parsed.date, timezone, durationMin: service.duration_min, bookedSlots,
  })
  const when = humanDate(parsed.date)

  if (!open) {
    return `Lo siento, el ${when} estamos cerrados. ¿Quieres que busquemos otra fecha?`
  }
  if (slots.length === 0) {
    return `Para el ${when} no me queda ningún horario libre para *${service.name}*. ¿Probamos con otro día?`
  }
  if (slots.length === 1) {
    // Phrased as a confirmation question → the 2-turn gate opens on "sí".
    return `¿Confirmo tu cita de *${service.name}* para el ${when} a las ${formatLocalTime(slots[0]!)}?`
  }
  const list = slots.slice(0, MAX_LISTED).map(formatLocalTime).join(', ')
  const more = slots.length > MAX_LISTED ? ', entre otros' : ''
  return `Para el ${when} tengo estos horarios libres para *${service.name}*: ${list}${more}. ¿A qué hora te viene bien?`
}
