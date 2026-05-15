/**
 * Spanish time-expression parser. Returns HH:mm 24-hour or null.
 *
 * Covers the shapes Deepgram tends to emit and the natural ways a Spanish
 * speaker dictates a time aloud:
 *
 *   "a las 3 de la tarde"       → 15:00
 *   "a las 9 am" / "a las 9 a.m." → 09:00
 *   "9:30"                       → 09:30
 *   "las nueve y media"          → 09:30
 *   "las nueve y cuarto"         → 09:15
 *   "tres de la tarde"           → 15:00
 *   "mediodía"                   → 12:00
 *   "medianoche"                 → 00:00
 *   "15:00" / "15h" / "15hs"     → 15:00
 *
 * Heuristic for digit-only "3" / "tres": assume PM when 1–7 and the user
 * said no period suffix, because morning visits at 1–7 are uncommon in this
 * SaaS's domain (salons). Returns null only when nothing matches — leaves
 * the caller to ask "¿a qué hora?".
 */

export interface ParsedTime {
  time:   string                       // HH:mm
  reason: string                       // matched fragment
}

const NUMBER_WORDS: Record<string, number> = {
  una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
}

const MINUTE_WORDS: Record<string, number> = {
  media: 30, cuarto: 15,
  cinco: 5, diez: 10, quince: 15, veinte: 20, veinticinco: 25, treinta: 30,
  cuarenta: 40, 'cuarenta y cinco': 45, cincuenta: 50,
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** Returns true when the corpus contains any token that signals "user mentioned a time". */
export function userMentionedTime(corpus: string): boolean {
  return parseTimeExpression(corpus) !== null
}

export function parseTimeExpression(text: string): ParsedTime | null {
  const raw = text.toLowerCase()
  const t   = stripAccents(raw)

  // ── 1. Mediodía / medianoche ─────────────────────────────────────────────
  if (/\bmediodia\b/.test(t)) return { time: '12:00', reason: 'mediodía' }
  if (/\bmedianoche\b/.test(t)) return { time: '00:00', reason: 'medianoche' }

  // ── 2. "HH:MM" or "HHhMM" or "HHh" ───────────────────────────────────────
  const colonRe = /\b(\d{1,2}):(\d{2})\b/
  const colonM  = t.match(colonRe)
  if (colonM) {
    const h = parseInt(colonM[1]!, 10)
    const m = parseInt(colonM[2]!, 10)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { time: `${pad2(h)}:${pad2(m)}`, reason: colonM[0]! }
    }
  }
  const hRe = /\b(\d{1,2})\s*h(?:s|rs)?\b/
  const hM  = t.match(hRe)
  if (hM) {
    const h = parseInt(hM[1]!, 10)
    if (h >= 0 && h <= 23) return { time: `${pad2(h)}:00`, reason: hM[0]! }
  }

  // ── 3. "a las N (y media|cuarto|MM)? (am|pm|de la <franja>)?" or "las N..." ─
  // Or "para las N", or bare "N de la mañana/tarde/noche".
  const hourWord = Object.keys(NUMBER_WORDS).join('|')
  const minuteWord = Object.keys(MINUTE_WORDS).join('|')
  const timeRe = new RegExp(
    `\\b(?:(?:a\\s+las?|para\\s+las?|las?)\\s+)?` +
    `(\\d{1,2}|${hourWord})` +
    `(?:\\s+(?:y\\s+(?:(\\d{1,2})|(${minuteWord}))|menos\\s+(?:cuarto|(\\d{1,2}))))?` +
    `(?:\\s*(am|pm|a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)|\\s+de\\s+la\\s+(manana|tarde|noche|madrugada)|\\s+del\\s+mediodia)?`,
  )
  const tm = t.match(timeRe)
  if (tm) {
    const hourTok = tm[1]!
    let hour = /^\d+$/.test(hourTok) ? parseInt(hourTok, 10) : (NUMBER_WORDS[hourTok] ?? NaN)
    if (isNaN(hour) || hour < 0 || hour > 23) return null

    let minute = 0
    if (tm[2]) {
      minute = parseInt(tm[2], 10)
    } else if (tm[3]) {
      minute = MINUTE_WORDS[tm[3]] ?? 0
    } else if (tm[4]) {
      minute = -parseInt(tm[4], 10)   // "menos N" → subtract
    } else if (/menos\s+cuarto/.test(tm[0]!)) {
      minute = -15
    }

    // Period suffix
    const period = tm[5]
    const franja = tm[6]
    let pm = false
    let am = false
    if (period) {
      const p = period.replace(/[.\s]/g, '')
      if (p === 'pm') pm = true
      else if (p === 'am') am = true
    }
    if (franja) {
      if (franja === 'manana' || franja === 'madrugada') am = true
      if (franja === 'tarde' || franja === 'noche') pm = true
    }

    // Apply am/pm
    if (pm && hour < 12) hour += 12
    if (am && hour === 12) hour = 0

    // Handle "menos N"
    if (minute < 0) {
      const absMin = -minute
      // shift to previous hour
      hour = (hour - 1 + 24) % 24
      minute = 60 - absMin
    }

    if (minute < 0 || minute > 59) return null

    // Heuristic: bare 1-7 with no period suffix → assume PM (salon hours)
    if (!period && !franja && hour >= 1 && hour <= 7) {
      // Only when we matched a real time prefix ("a las", "las", "para las").
      // A bare "3" without any of those is too risky — return null instead.
      const hasPrefix = /(a\s+las?|para\s+las?|^las?\s|\slas?\s)/.test(' ' + tm[0]!)
      if (!hasPrefix) return null
      hour += 12
    }

    // Require an unambiguous trigger: either a digit:digit form, "h", a period
    // suffix, a franja, or one of the "las/a las/para las" prefixes. A bare
    // "3" by itself is too ambiguous to count as a time.
    const hasUnambiguous =
      /:|h|am|pm|a\.?\s*m|p\.?\s*m|manana|tarde|noche|madrugada|mediodia/.test(tm[0]!)
      || /(a\s+las?|para\s+las?|^las?\s|\slas?\s)/.test(' ' + tm[0]!)
    if (!hasUnambiguous) return null

    return { time: `${pad2(hour)}:${pad2(minute)}`, reason: tm[0]! }
  }

  return null
}
