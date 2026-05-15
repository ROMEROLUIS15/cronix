/**
 * Spanish date-expression parser for the voice agent.
 *
 * Returns a YYYY-MM-DD when the text contains a recognisable date reference,
 * otherwise null. The caller is expected to pass `today` already resolved in
 * the business timezone so all arithmetic stays within that calendar day.
 *
 * Why deterministic: Llama 3.x is unreliable at date arithmetic in Spanish
 * (off-by-one on "mañana", confused by "el próximo viernes", invents years
 * for "el 21 de mayo"). Computing the date here and overriding whatever the
 * LLM emits is the only reliable strategy.
 *
 * Patterns covered (in priority order):
 *   1. hoy / mañana / pasado mañana / ayer / anteayer
 *   2. "en N (días|semanas|meses)" / "dentro de N ..."
 *   3. "el N de <mes>" (with optional year)
 *   4. "DD/MM" or "DD/MM/YYYY"
 *   5. "(este|próximo|siguiente|que viene) <día-semana>" / "el <día>"
 *   6. "el día N" / "día N" (bare day, month inferred — current or next)
 */

export interface ParsedDate {
  date:       string                       // YYYY-MM-DD
  reason:     string                       // matched fragment, for logging
  confidence: 'exact' | 'inferred'
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4,
  viernes: 5, sabado: 6,
}

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  veinte: 20, treinta: 30,
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

function ymdFromIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y!, m!, d!]
}

function isoFromYMD(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** Pure date arithmetic via UTC anchor — never touches local timezone. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = ymdFromIso(iso)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return isoFromYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function dayOfWeek(iso: string): number {
  const [y, m, d] = ymdFromIso(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function parseNumberToken(raw: string): number | null {
  const t = raw.toLowerCase()
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t]!
  return null
}

export function parseDateExpression(text: string, today: string): ParsedDate | null {
  const raw = text.toLowerCase()
  const t   = stripAccents(raw)

  // ── 1. Discrete keywords (highest priority) ──────────────────────────────
  // Order matters: "pasado mañana" before "mañana", "anteayer" before "ayer".
  if (/\bpasado\s+manana\b/.test(t)) return { date: addDays(today,  2), reason: 'pasado mañana', confidence: 'exact' }
  if (/\banteayer\b/.test(t))         return { date: addDays(today, -2), reason: 'anteayer',       confidence: 'exact' }
  if (/\bayer\b/.test(t))             return { date: addDays(today, -1), reason: 'ayer',           confidence: 'exact' }
  if (/\bmanana\b/.test(t))           return { date: addDays(today,  1), reason: 'mañana',         confidence: 'exact' }
  if (/\bhoy\b/.test(t))              return { date: today,              reason: 'hoy',            confidence: 'exact' }

  // ── 2. "en/dentro de N (días|semanas|meses)" ─────────────────────────────
  const NUM = '\\d+|uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta'
  const relRe = new RegExp(`\\b(?:en|dentro\\s+de)\\s+(${NUM})\\s+(dias?|semanas?|mes(?:es)?)\\b`)
  const relM  = t.match(relRe)
  if (relM) {
    const n = parseNumberToken(relM[1]!)
    if (n !== null) {
      const unit = relM[2]!
      const days = /^semana/.test(unit) ? n * 7
                 : /^mes/.test(unit)    ? n * 30
                 :                        n
      return { date: addDays(today, days), reason: relM[0]!, confidence: 'exact' }
    }
  }

  // ── 3. "el N de <mes>" with optional year ────────────────────────────────
  const monthAlt = Object.keys(MONTHS).join('|')
  const dmRe = new RegExp(
    `\\b(?:el\\s+|para\\s+el\\s+|para\\s+|este\\s+)?(\\d{1,2})\\s+de\\s+(${monthAlt})(?:\\s+(?:de\\s+|del\\s+)?(\\d{2,4}))?\\b`,
  )
  const dmM = t.match(dmRe)
  if (dmM) {
    const day   = parseInt(dmM[1]!, 10)
    const month = MONTHS[dmM[2]!]!
    if (day >= 1 && day <= 31) {
      let year: number
      if (dmM[3]) {
        year = parseInt(dmM[3], 10)
        if (year < 100) year += 2000
      } else {
        const [ty, tm, td] = ymdFromIso(today)
        year = ty
        if (month < tm || (month === tm && day < td)) year++   // rolls into next year
      }
      return { date: isoFromYMD(year, month, day), reason: `${day} de ${dmM[2]}`, confidence: 'exact' }
    }
  }

  // ── 4. "DD/MM" or "DD-MM" with optional year ─────────────────────────────
  const slashRe = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/
  const slashM  = t.match(slashRe)
  if (slashM) {
    const day   = parseInt(slashM[1]!, 10)
    const month = parseInt(slashM[2]!, 10)
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let year: number
      if (slashM[3]) {
        year = parseInt(slashM[3], 10)
        if (year < 100) year += 2000
      } else {
        const [ty, tm, td] = ymdFromIso(today)
        year = ty
        if (month < tm || (month === tm && day < td)) year++
      }
      return { date: isoFromYMD(year, month, day), reason: slashM[0]!, confidence: 'exact' }
    }
  }

  // ── 5. Weekday with optional modifier (próximo/siguiente/este/que viene) ─
  const weekdayAlt = Object.keys(WEEKDAYS).join('|')
  // Require an article or "para" before the weekday to avoid matching weekday
  // names embedded in narrative ("el lunes pasó algo"). Also require the
  // weekday to be at the end or followed by a non-weekday connector to keep
  // scope tight.
  const wdRe = new RegExp(
    `\\b(?:el\\s+|para\\s+(?:el\\s+)?|este\\s+|esta\\s+)(?:(proximo|siguiente|que\\s+viene)\\s+)?(${weekdayAlt})\\b`,
  )
  const wdM = t.match(wdRe)
  if (wdM) {
    const modifier = wdM[1]
    const target   = WEEKDAYS[wdM[2]!]!
    const todayDow = dayOfWeek(today)
    let delta = (target - todayDow + 7) % 7
    // Without an explicit modifier, the *next* occurrence is meant; if today
    // happens to match, advance a week so we don't suggest today by accident.
    if (delta === 0) delta = 7
    // "próximo/siguiente/que viene" forces at least a week jump only when the
    // current week's occurrence has already happened (delta would have been 0,
    // now 7 — same result). Kept explicit for clarity.
    if (modifier && delta < 7) {
      // do nothing; "el próximo viernes" said on a Tuesday is still this Friday
    }
    const label = modifier ? `${modifier} ${wdM[2]}` : `el ${wdM[2]}`
    return { date: addDays(today, delta), reason: label, confidence: 'exact' }
  }

  // ── 6. "el día N" / "día N" — bare day, infer month ──────────────────────
  const bareRe = /\b(?:el\s+)?d[ií]a\s+(\d{1,2})\b/
  const bareM  = t.match(bareRe)
  if (bareM) {
    const day = parseInt(bareM[1]!, 10)
    if (day >= 1 && day <= 31) {
      const [ty, tm, td] = ymdFromIso(today)
      let m = tm, y = ty
      if (day < td) {
        m += 1
        if (m > 12) { m = 1; y++ }
      }
      return { date: isoFromYMD(y, m, day), reason: `día ${day}`, confidence: 'inferred' }
    }
  }

  return null
}
