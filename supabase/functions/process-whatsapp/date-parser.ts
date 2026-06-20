/**
 * Spanish date-expression parser — WhatsApp agent mirror.
 *
 * Deterministic YYYY-MM-DD resolver. Llama 3.x is unreliable at Spanish date
 * arithmetic, so we compute the date here and never let the model invent it.
 *
 * This is a faithful mirror of voice-worker/core/date-parser.ts (parity kept
 * intentionally — same pure logic, no Deno-specific imports). Edge functions
 * don't share a module here, so the parser is duplicated rather than coupling
 * process-whatsapp to the voice-worker tree.
 */

export interface ParsedDate {
  date:       string
  reason:     string
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

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = ymdFromIso(a)
  const [by, bm, bd] = ymdFromIso(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

function pickYear(today: string, month: number, day: number, prefer: 'future' | 'nearest'): number {
  const [ty, tm, td] = ymdFromIso(today)
  if (prefer === 'nearest') {
    let best = ty
    let bestDist = Infinity
    for (const y of [ty - 1, ty, ty + 1]) {
      const dist = Math.abs(daysBetween(today, isoFromYMD(y, month, day)))
      if (dist < bestDist) { bestDist = dist; best = y }
    }
    return best
  }
  let year = ty
  if (month < tm || (month === tm && day < td)) year++
  return year
}

function parseNumberToken(raw: string): number | null {
  const t = raw.toLowerCase()
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t]!
  return null
}

/**
 * Parses a Spanish date expression into YYYY-MM-DD relative to `today`
 * (already resolved in the business timezone). Returns null when no
 * recognisable date reference is present.
 *
 * `prefer` controls bare day+month year selection: 'future' (default, for
 * booking) picks the next upcoming occurrence; 'nearest' picks the closest
 * across prev/this/next year (for past-leaning agenda queries).
 */
export function parseDateExpression(
  text:   string,
  today:  string,
  prefer: 'future' | 'nearest' = 'future',
): ParsedDate | null {
  const raw = text.toLowerCase()
  const t   = stripAccents(raw)

  if (/\bpasado\s+manana\b/.test(t)) return { date: addDays(today,  2), reason: 'pasado mañana', confidence: 'exact' }
  if (/\banteayer\b/.test(t))         return { date: addDays(today, -2), reason: 'anteayer',       confidence: 'exact' }
  if (/\bayer\b/.test(t))             return { date: addDays(today, -1), reason: 'ayer',           confidence: 'exact' }
  if (/\bmanana\b/.test(t))           return { date: addDays(today,  1), reason: 'mañana',         confidence: 'exact' }
  if (/\bhoy\b/.test(t))              return { date: today,              reason: 'hoy',            confidence: 'exact' }

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
        year = pickYear(today, month, day, prefer)
      }
      return { date: isoFromYMD(year, month, day), reason: `${day} de ${dmM[2]}`, confidence: 'exact' }
    }
  }

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
        year = pickYear(today, month, day, prefer)
      }
      return { date: isoFromYMD(year, month, day), reason: slashM[0]!, confidence: 'exact' }
    }
  }

  const weekdayAlt = Object.keys(WEEKDAYS).join('|')
  // Prefix (el/este/próximo…) is OPTIONAL so a bare weekday ("domingo") parses too.
  const wdRe = new RegExp(
    `\\b(?:el\\s+|del\\s+|para\\s+(?:el\\s+)?|este\\s+|esta\\s+|en\\s+el\\s+)?(?:(proximo|siguiente|que\\s+viene)\\s+)?(${weekdayAlt})\\b`,
  )
  const wdM = t.match(wdRe)
  if (wdM) {
    const modifier = wdM[1]
    const target   = WEEKDAYS[wdM[2]!]!
    const todayDow = dayOfWeek(today)
    let delta = (target - todayDow + 7) % 7
    if (delta === 0) delta = 7
    const label = modifier ? `${modifier} ${wdM[2]}` : `el ${wdM[2]}`
    return { date: addDays(today, delta), reason: label, confidence: 'exact' }
  }

  // Day-of-month inference shared by the "día N" and bare-"el N"/"N" forms:
  // if the day already passed this month, roll to next month.
  const dayToDate = (day: number): ParsedDate | null => {
    if (day < 1 || day > 31) return null
    const [ty, tm, td] = ymdFromIso(today)
    let m = tm, y = ty
    if (day < td) { m += 1; if (m > 12) { m = 1; y++ } }
    return { date: isoFromYMD(y, m, day), reason: `el ${day}`, confidence: 'inferred' }
  }

  const bareM = t.match(/\b(?:el\s+)?d[ií]a\s+(\d{1,2})\b/)
  if (bareM) { const d = dayToDate(parseInt(bareM[1]!, 10)); if (d) return d }

  // Bare day-of-month WITHOUT the word "día": "(para) el 21", or the whole text "21".
  // `el?` tolerates the common typo "e 23" (missing "l"); a lone Spanish "e"/"el"
  // before a number is only ever the article, never a real word, so it stays safe.
  // (Years like "2026" don't match: (\d{1,2}) can't sit inside a longer digit run.)
  const elDayM = t.match(/\bel?\s+(\d{1,2})\b/) ?? t.match(/^\s*(?:para\s+)?(\d{1,2})\s*$/)
  if (elDayM) { const d = dayToDate(parseInt(elDayM[1]!, 10)); if (d) return d }

  return null
}
