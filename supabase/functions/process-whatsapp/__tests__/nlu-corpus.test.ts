/**
 * nlu-corpus.test.ts — Golden corpus for date/time understanding + voice↔whatsapp parity.
 *
 * The NLU has been the recurring source of bugs (each ambiguity — day vs hour, accents,
 * typos — was a separate fix). This corpus locks the grammar so a refactor or a future
 * tweak that regresses ANY case fails loudly, and the PARITY block guarantees the
 * WhatsApp and Voice parsers (intentionally mirrored, not shared) never drift apart.
 */

import { describe, it, expect } from 'vitest'
import { parseDateExpression } from '../date-parser.ts'
import { parseDateExpression as parseDateVoice } from '../../voice-worker/core/date-parser.ts'
import { parseDateTime, extractTime } from '../datetime-nlu.ts'

const TODAY = '2026-06-19' // Friday — fixed for determinism

// Inputs the parser must resolve to a date (used for BOTH golden values and parity).
const DATE_CORPUS = [
  'hoy', 'mañana', 'pasado mañana', 'ayer', 'anteayer',
  'en 3 días', 'dentro de 2 semanas',
  'el lunes', 'lunes', 'domingo', 'próximo viernes', 'el martes que viene',
  '21 de junio', '25 de diciembre', '1 de enero', '3 de marzo de 2027',
  'el 21', '21', 'para el 21', 'para e 23', 'el 10', 'día 5',
  '25/12', '25/12/2026', '10-07',
  'hola', 'gracias', 'electronica', '',
] as const

describe('NLU date corpus — golden values (WhatsApp parser)', () => {
  it.each([
    ['hoy',                 '2026-06-19'],
    ['mañana',              '2026-06-20'],
    ['pasado mañana',       '2026-06-21'],
    ['ayer',                '2026-06-18'],
    ['en 3 días',           '2026-06-22'],
    ['dentro de 2 semanas', '2026-07-03'],
    ['el lunes',            '2026-06-22'],
    ['domingo',             '2026-06-21'],
    ['21 de junio',         '2026-06-21'],
    ['25 de diciembre',     '2026-12-25'],
    ['1 de enero',          '2027-01-01'], // past this year → next
    ['el 21',               '2026-06-21'],
    ['21',                  '2026-06-21'],
    ['para e 23',           '2026-06-23'], // typo "e" for "el"
    ['el 10',               '2026-07-10'], // day already passed → next month
    ['25/12',               '2026-12-25'],
  ])('parses "%s" → %s', (input, expected) => {
    expect(parseDateExpression(input, TODAY, 'future')?.date).toBe(expected)
  })

  it('never invents a date for non-date text', () => {
    for (const t of ['hola', 'gracias', 'electronica', '']) {
      expect(parseDateExpression(t, TODAY, 'future')).toBeNull()
    }
  })
})

describe('NLU time/combined corpus — golden values', () => {
  it.each([
    ['15:00',               null,         '15:00'],
    ['9:30',                null,         '09:30'],
    ['11 am',               null,         '11:00'],
    ['3 pm',                null,         '15:00'],
    ['a las 11',            null,         '11:00'],
    ['a las 5',             null,         '17:00'], // ambiguous 1–7 → PM
    ['a las 9',             null,         '09:00'],
    ['5 am',                null,         '05:00'],
    ['9 de la noche',       null,         '21:00'],
    ['mediodía',            null,         '12:00'],
    ['21 a las 11 am',      '2026-06-21', '11:00'],
    ['mañana a las 3 pm',   '2026-06-20', '15:00'],
    ['para e 23 a las 5',   '2026-06-23', '17:00'], // typo date + ambiguous PM
  ])('parses "%s" → date=%s time=%s', (input, date, time) => {
    const r = parseDateTime(input, TODAY)
    expect(r.date).toBe(date)
    expect(r.time).toBe(time)
  })

  it('expecting:"time" makes a bare number the hour, not the day', () => {
    expect(parseDateTime('10', TODAY, { expecting: 'time' })).toEqual({ date: null, time: '10:00' })
    expect(parseDateTime('5',  TODAY, { expecting: 'time' })).toEqual({ date: null, time: '17:00' })
  })
})

// ── PARITY: WhatsApp and Voice parsers must produce identical output ──────────
describe('date-parser parity (WhatsApp ↔ Voice) — never drift', () => {
  it.each(DATE_CORPUS)('"%s" resolves identically in both parsers', (input) => {
    for (const prefer of ['future', 'nearest'] as const) {
      const wa    = parseDateExpression(input, TODAY, prefer)
      const voice = parseDateVoice(input, TODAY, prefer)
      expect({ date: wa?.date ?? null }).toEqual({ date: voice?.date ?? null })
    }
  })
})
