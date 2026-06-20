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
    // Ambiguous bare hour 1–7 (no am/pm) → afternoon, a business never opens at 5 AM.
    ['a las 5',           null,         '17:00'],
    ['a las 3',           null,         '15:00'],
    ['a las 5 am',        null,         '05:00'], // explicit am is still respected
    ['a las 9',           null,         '09:00'], // 8–12 stay literal (morning is plausible)
    // Bare day with the "e 23" typo (missing "l") + ambiguous hour, in one message.
    ['para e 23 a las 5', '2026-06-23', '17:00'],
    ['e 23',              '2026-06-23', null],
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

describe('parseDateTime — expecting:"time" (bare number is the hour, not the day)', () => {
  it('parses a bare number as the hour when the agent just asked the time', () => {
    expect(parseDateTime('10', TODAY, { expecting: 'time' })).toEqual({ date: null, time: '10:00' })
    expect(parseDateTime('5',  TODAY, { expecting: 'time' })).toEqual({ date: null, time: '17:00' }) // 1–7 → PM
    expect(parseDateTime('10:30', TODAY, { expecting: 'time' })).toEqual({ date: null, time: '10:30' })
  })
  it('still treats an EXPLICIT date reply as a date, even when expecting a time', () => {
    expect(parseDateTime('el 10', TODAY, { expecting: 'time' }).date).toBe('2026-07-10') // day 10 → next July
    expect(parseDateTime('10 de julio', TODAY, { expecting: 'time' }).date).toBe('2026-07-10')
  })
  it('without the hint, a bare number is still the day-of-month', () => {
    expect(parseDateTime('10', TODAY).date).toBe('2026-07-10')
    expect(parseDateTime('10', TODAY).time).toBeNull()
  })
})
