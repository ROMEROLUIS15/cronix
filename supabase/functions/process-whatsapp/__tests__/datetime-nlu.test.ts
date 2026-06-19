/**
 * datetime-nlu.test.ts — Natural date/time understanding (operacion-canonica §3.3-bis).
 * These inputs all FAILED before the refactor (the parser was too rigid and a bare day
 * was confused with the hour). The grammar in the spec is the contract.
 */

import { describe, it, expect } from 'vitest'
import { parseDateTime, extractTime } from '../datetime-nlu.ts'

const TODAY = '2026-06-19' // Friday

describe('parseDateTime — grammar from the spec', () => {
  it.each([
    // [input, expected date, expected time]
    ['21 a las 11 am',    '2026-06-21', '11:00'], // bare day + time in one message (the key bug)
    ['el 21',             '2026-06-21', null],
    ['21',                '2026-06-21', null],
    ['Para el 21',        '2026-06-21', null],
    ['21 de junio',       '2026-06-21', null],
    ['mañana a las 3 pm', '2026-06-20', '15:00'],
    ['el lunes',          '2026-06-22', null],    // Mon after Fri 19
    ['domingo',           '2026-06-21', null],    // bare weekday → Sun 21
    ['a las 11',          null,         '11:00'],
    ['11 am',             null,         '11:00'],
    ['hola',              null,         null],     // never invents
  ])('parses "%s" → date=%s time=%s', (input, date, time) => {
    const r = parseDateTime(input, TODAY)
    expect(r.date).toBe(date)
    expect(r.time).toBe(time)
  })

  it('named times', () => {
    expect(extractTime('mediodía')).toBe('12:00')
    expect(extractTime('medianoche')).toBe('00:00')
  })
})
