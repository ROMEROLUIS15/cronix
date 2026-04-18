/**
 * date-normalize.ts — Fecha normalización sin LLM.
 *
 * Convierte términos relativos ("mañana", "el lunes", "el 27") a YYYY-MM-DD.
 * Nunca lanza excepciones — si la entrada es ambigua o inválida, retorna null.
 *
 * NO usa LLM. Es determinista y timezone-aware.
 *
 * Expone: normalizeDateInput(input, timezone) → string | null
 */

// Días de la semana en español → índice JS (0=domingo)
const DAY_MAP: Record<string, number> = {
  domingo:   0,
  lunes:     1,
  martes:    2,
  miércoles: 3,
  miercoles: 3,
  jueves:    4,
  viernes:   5,
  sábado:    6,
  sabado:    6,
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayInTz(timezone: string): Date {
  // Parse the current date/time as seen in the business timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())

  const year  = parseInt(parts.find(p => p.type === 'year')?.value  ?? '0', 10)
  const month = parseInt(parts.find(p => p.type === 'month')?.value ?? '0', 10)
  const day   = parseInt(parts.find(p => p.type === 'day')?.value   ?? '0', 10)

  // Return a Date in local (server) time that represents midnight of that calendar day.
  // We only use getFullYear/Month/Date from this — no offset math needed.
  return new Date(year, month - 1, day)
}

/**
 * Normalizes a user-provided date string to YYYY-MM-DD.
 *
 * Handles:
 *   - "hoy", "mañana", "pasado mañana"
 *   - "el lunes", "el martes" ... (next occurrence of that weekday)
 *   - "el 27", "el 5 de mayo" → assumes current/next month
 *   - "2026-04-16", "16/04/2026", "16-04-2026"
 *
 * Returns null if the input cannot be resolved to a valid date.
 * The caller (DecisionEngine) should treat null as "date not determinable from text".
 */
export function normalizeDateInput(raw: string, timezone: string): string | null {
  if (!raw || raw.trim().length === 0) return null

  const text = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[¿?¡!.,;:]/g, '')
    .trim()

  const today = todayInTz(timezone)

  // ── Relative keywords (order matters: most specific first) ─────────────────
  // "pasado mañana" must be checked BEFORE "mañana" to avoid partial match.

  if (text.includes('pasado manana') || text.includes('pasado mañana')) {
    const d = new Date(today)
    d.setDate(d.getDate() + 2)
    return toISODate(d)
  }

  if (text === 'hoy' || text.includes('hoy')) {
    return toISODate(today)
  }

  if (text === 'manana' || text.includes('manana') || text.includes('mañana')) {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    return toISODate(d)
  }

  // ── Weekday resolution: "el lunes", "lunes", "el próximo martes" ─────────────
  for (const [name, targetDay] of Object.entries(DAY_MAP)) {
    if (text.includes(name)) {
      const d = new Date(today)
      const currentDay = d.getDay()
      let diff = targetDay - currentDay
      // If today is that same weekday, go to next week (don't book today)
      if (diff <= 0) diff += 7
      d.setDate(d.getDate() + diff)
      return toISODate(d)
    }
  }

  // ── ISO: "2026-04-16" ────────────────────────────────────────────────────────
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch?.[1] && isoMatch[2] && isoMatch[3]) {
    const d = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10))
    if (!isNaN(d.getTime())) return toISODate(d)
  }

  // ── EU format: "16/04/2026" or "16-04-2026" ──────────────────────────────────
  const euMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (euMatch?.[1] && euMatch[2] && euMatch[3]) {
    const d = new Date(parseInt(euMatch[3], 10), parseInt(euMatch[2], 10) - 1, parseInt(euMatch[1], 10))
    if (!isNaN(d.getTime())) return toISODate(d)
  }

  // ── "el 27" or "27 de mayo" ───────────────────────────────────────────────────
  const MONTHS: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  }
  const withMonthMatch = text.match(/(\d{1,2})\s+de\s+([a-z]+)/)
  if (withMonthMatch?.[1] && withMonthMatch[2]) {
    const dayNum   = parseInt(withMonthMatch[1], 10)
    const monthNum = MONTHS[withMonthMatch[2]]
    if (monthNum !== undefined) {
      const year = today.getFullYear()
      const d    = new Date(year, monthNum, dayNum)
      // If the resolved date is in the past, bump to next year
      if (d < today) d.setFullYear(year + 1)
      if (!isNaN(d.getTime())) return toISODate(d)
    }
  }

  // "el 27" → assume current month (or next month if already past)
  const dayOnlyMatch = text.match(/\bel\s+(\d{1,2})\b/)
  if (dayOnlyMatch?.[1]) {
    const dayNum = parseInt(dayOnlyMatch[1], 10)
    if (dayNum >= 1 && dayNum <= 31) {
      const d = new Date(today.getFullYear(), today.getMonth(), dayNum)
      if (d <= today) d.setMonth(d.getMonth() + 1)
      if (!isNaN(d.getTime())) return toISODate(d)
    }
  }

  return null
}

/**
 * Normalizes a user-provided time string to HH:mm (24h).
 *
 * Handles:
 *   - "3pm", "3 pm", "3:00 pm", "15:00", "3 de la tarde", "mediodía"
 *
 * Returns null if the time cannot be resolved.
 */
export function normalizeTimeInput(raw: string): string | null {
  if (!raw || raw.trim().length === 0) return null

  const text = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  // "mediodía" / "mediodia"
  if (text.includes('mediodia') || text.includes('mediodía')) return '12:00'
  if (text.includes('medianoche'))                              return '00:00'

  // "de la tarde" / "en la tarde" → pm bias
  const afternoonBias = /de\s+la\s+tarde|en\s+la\s+tarde|de\s+la\s+noche|en\s+la\s+noche/.test(text)
  const morningBias   = /de\s+la\s+manana|de\s+la\s+mañana|en\s+la\s+manana/.test(text)

  // HH:mm pattern
  const hhmm = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/)
  if (hhmm?.[1] && hhmm[2]) {
    let hours = parseInt(hhmm[1], 10)
    const mins = hhmm[2]
    const period = hhmm[3]

    if (period === 'pm' && hours < 12) hours += 12
    else if (period === 'am' && hours === 12) hours = 0
    else if (!period && afternoonBias && hours >= 1 && hours <= 11) hours += 12
    else if (!period && morningBias  && hours === 12) hours = 0

    if (hours >= 0 && hours <= 23) {
      return `${String(hours).padStart(2, '0')}:${mins}`
    }
  }

  // "3pm" / "3 pm" without minutes
  const hourOnly = text.match(/(\d{1,2})\s*(am|pm)/)
  if (hourOnly?.[1] && hourOnly[2]) {
    let hours = parseInt(hourOnly[1], 10)
    if (hourOnly[2] === 'pm' && hours < 12) hours += 12
    if (hourOnly[2] === 'am' && hours === 12) hours = 0
    if (hours >= 0 && hours <= 23) {
      return `${String(hours).padStart(2, '0')}:00`
    }
  }

  // "3 de la tarde" / "3 de la mañana" — standalone pattern (no "las" prefix)
  // Note: by this point text has been NFD-normalized, so mañana → manana.
  const standaloneNum = text.match(/\b(\d{1,2})\s+de\s+la\s+(tarde|manana|mañana|noche)\b/)
  if (standaloneNum?.[1] && standaloneNum[2]) {
    let hours = parseInt(standaloneNum[1], 10)
    const context = standaloneNum[2]
    if ((context === 'tarde' || context === 'noche') && hours >= 1 && hours <= 11) hours += 12
    // After NFD normalize: 'manana' covers 'mañana'
    if (context === 'manana' && hours >= 1 && hours <= 11) {
      // morning hours stay as-is (1..11 are correct)
    }
    if (context === 'manana' && hours === 12) hours = 0
    if (hours >= 0 && hours <= 23) return `${String(hours).padStart(2, '0')}:00`
  }

  // Bare number with afternoon bias: "a las 3 de la tarde"
  if (afternoonBias) {
    const bareNum = text.match(/\blas?\s+(\d{1,2})\b/)
    if (bareNum?.[1]) {
      let hours = parseInt(bareNum[1], 10)
      if (hours >= 1 && hours <= 11) hours += 12
      if (hours >= 0 && hours <= 23) return `${String(hours).padStart(2, '0')}:00`
    }
  }

  // Bare number with morning bias: "a las 3 de la mañana"
  if (morningBias) {
    const bareNum = text.match(/\blas?\s+(\d{1,2})\b/)
    if (bareNum?.[1]) {
      let hours = parseInt(bareNum[1], 10)
      if (hours === 12) hours = 0
      if (hours >= 0 && hours <= 23) return `${String(hours).padStart(2, '0')}:00`
    }
  }

  return null
}

/**
 * Extracts date and time entities from free text.
 * Thin wrapper over normalizeDateInput + normalizeTimeInput.
 *
 * Returns { date: string | null, time: string | null }.
 * Both can be null if nothing was recognized.
 */
export function extractEntities(
  text: string,
  timezone: string,
): { date: string | null; time: string | null } {
  return {
    date: normalizeDateInput(text, timezone),
    time: normalizeTimeInput(text),
  }
}
