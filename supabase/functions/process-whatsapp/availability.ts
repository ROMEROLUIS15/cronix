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

const SLOT_INTERVAL = 30

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** Local 'YYYY-MM-DD' for the business "today". */
export function todayInTimezone(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
}

// Dashboard day keys (mon..sun), indexed by Date.getUTCDay() (0=Sunday).
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * ISO dates of the next `count` OPEN days strictly after `fromISO` (≤30-day horizon).
 * Pure: used to suggest concrete alternative dates when a requested day is closed.
 * A day is open when its working_hours entry is a valid [open,close] tuple (or when
 * hours are unconfigured — then every day counts as open, mirroring computeAvailableSlots).
 */
export function nextOpenDates(workingHours: WorkingHours, fromISO: string, count: number): string[] {
  const out: string[] = []
  const configured = !!workingHours && Object.keys(workingHours).length > 0
  const [y, m, d] = fromISO.split('-').map(Number) as [number, number, number]
  const cur = new Date(Date.UTC(y, m - 1, d))
  for (let i = 0; i < 30 && out.length < count; i++) {
    cur.setUTCDate(cur.getUTCDate() + 1)
    if (!configured) { out.push(cur.toISOString().slice(0, 10)); continue }
    const wh = workingHours![DAY_KEYS[cur.getUTCDay()]!]
    if (wh && Array.isArray(wh) && wh.length >= 2) out.push(cur.toISOString().slice(0, 10))
  }
  return out
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
