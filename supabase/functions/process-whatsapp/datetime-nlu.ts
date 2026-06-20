/**
 * datetime-nlu.ts — Single source of truth for understanding the date AND time a
 * client stated in one message. Consolidates what used to be split across
 * date-parser.ts (date) and booking-flow.ts (time), which is why "21 a las 11"
 * failed: a bare day number was indistinguishable from the hour.
 *
 * Contract (operacion-canonica §3.3-bis):
 *  - parseDateTime parses the TIME first, strips its span, then parses the DATE from
 *    the remainder — so "21 a las 11" → { date: day-21, time: 11:00 } unambiguously.
 *  - Never invents: returns null for whatever the client didn't state.
 */

import { parseDateExpression } from './date-parser.ts'

function pad2(n: number): string { return String(n).padStart(2, '0') }

/**
 * A bare spoken hour 1–7 with no am/pm and no franja ("a las 5", "para el 23 a las 5")
 * means the afternoon: a business runs 1–7 PM, never 1–7 AM (near-zero probability), so
 * we resolve it to PM. 8–12 stay literal (plausible morning hours). The slot is still
 * validated against working hours, so a genuinely-wrong guess just offers the real slots.
 */
function disambiguateBareHour(h: number): number {
  return h >= 1 && h <= 7 ? h + 12 : h
}

interface TimeSpan { time: string; start: number; end: number }

/** Extracts the first explicit clock time the client stated, plus its match span. */
function extractTimeSpan(text: string): TimeSpan | null {
  const t = text.toLowerCase()

  // 1) HH:mm, optionally with am/pm.
  let m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/)
  if (m && m.index !== undefined) {
    let h = parseInt(m[1]!, 10)
    const min = m[2]!
    const ap  = (m[3] ?? '').replace(/[.\s]/g, '')
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h <= 23) return { time: `${pad2(h)}:${min}`, start: m.index, end: m.index + m[0].length }
  }

  // 2) Named times.
  m = t.match(/\bmediod[íi]a\b/)
  if (m && m.index !== undefined) return { time: '12:00', start: m.index, end: m.index + m[0].length }
  m = t.match(/\bmedianoche\b/)
  if (m && m.index !== undefined) return { time: '00:00', start: m.index, end: m.index + m[0].length }

  // 3) "a las N", "N am/pm", "N de la mañana/tarde/noche".
  m = t.match(/\b(?:a\s+las?|para\s+las?)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/)
    ?? t.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|de\s+la\s+(?:ma[nñ]ana|tarde|noche))\b/)
  if (m && m.index !== undefined) {
    let h = parseInt(m[1]!, 10)
    const min  = m[2] ?? '00'
    const tail = (m[3] ?? '').replace(/[.\s]/g, '')
    const isPm = tail.startsWith('p') || /tarde|noche/.test(tail)
    const isAm = tail.startsWith('a') || /manana|mañana/.test(tail)
    if (isPm && h < 12) h += 12
    else if (isAm && h === 12) h = 0
    else if (!isPm && !isAm) h = disambiguateBareHour(h) // ambiguous "a las 5" → 17:00
    if (h <= 23) return { time: `${pad2(h)}:${min}`, start: m.index, end: m.index + m[0].length }
  }

  return null
}

/** Time the client stated (24h HH:mm), or null. Never guesses. */
export function extractTime(text: string): string | null {
  return extractTimeSpan(text)?.time ?? null
}

/**
 * Combined date+time understanding. Parses the time, removes its span from the text,
 * then parses the date from the remainder so a bare day ("21") is never mistaken for
 * the hour. Returns nulls for anything the client didn't say.
 */
export function parseDateTime(text: string, today: string): { date: string | null; time: string | null } {
  const ts = extractTimeSpan(text)
  const time = ts ? ts.time : null
  const dateText = ts ? `${text.slice(0, ts.start)} ${text.slice(ts.end)}` : text
  const date = parseDateExpression(dateText, today, 'future')?.date ?? null
  return { date, time }
}
