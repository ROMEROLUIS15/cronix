/**
 * time-format.test.ts — DST / timezone round-trip guards.
 *
 * Guards the bug class the June 2026 audit found (§7): cancel/reschedule rendered
 * the appointment in UTC instead of the business-local time because the code
 * sliced `start_at` directly. The fix routes through `utcToLocalParts`. These
 * tests pin local↔UTC conversion across fixed-offset and DST zones so the bug
 * cannot silently return.
 */

import { describe, it, expect } from 'vitest'
import { localToUTC, utcToLocalParts, buildEndISO } from '../time-format.ts'

describe('localToUTC — local wall time → UTC ISO', () => {
  it('fixed offset −05 (America/Bogota): 15:00 local → 20:00Z', () => {
    expect(localToUTC('2026-06-10', '15:00', 'America/Bogota')).toBe('2026-06-10T20:00:00.000Z')
  })

  it('fixed offset −04 (America/Caracas): 09:30 local → 13:30Z', () => {
    expect(localToUTC('2026-06-10', '09:30', 'America/Caracas')).toBe('2026-06-10T13:30:00.000Z')
  })

  it('crosses the date boundary: 22:00 Bogota → 03:00Z next day', () => {
    expect(localToUTC('2026-06-10', '22:00', 'America/Bogota')).toBe('2026-06-11T03:00:00.000Z')
  })

  it('DST-aware (Europe/Madrid): same 15:00 local maps to different UTC by season', () => {
    expect(localToUTC('2026-07-15', '15:00', 'Europe/Madrid')).toBe('2026-07-15T13:00:00.000Z') // CEST +02
    expect(localToUTC('2026-01-15', '15:00', 'Europe/Madrid')).toBe('2026-01-15T14:00:00.000Z') // CET  +01
  })

  it('DST-aware (America/New_York): 12:00 local differs summer vs winter', () => {
    expect(localToUTC('2026-07-15', '12:00', 'America/New_York')).toBe('2026-07-15T16:00:00.000Z') // EDT −04
    expect(localToUTC('2026-01-15', '12:00', 'America/New_York')).toBe('2026-01-15T17:00:00.000Z') // EST −05
  })
})

describe('utcToLocalParts — UTC ISO → business-local {date, time}', () => {
  it('renders the LOCAL hour, not the UTC slice (the §7 bug)', () => {
    // Naive `start_at.slice(11,16)` would have returned "20:00"; local is 15:00.
    expect(utcToLocalParts('2026-06-10T20:00:00Z', 'America/Bogota')).toEqual({ date: '2026-06-10', time: '15:00' })
  })

  it('rolls the date back when UTC is past midnight but local is the previous day', () => {
    expect(utcToLocalParts('2026-06-11T03:00:00Z', 'America/Bogota')).toEqual({ date: '2026-06-10', time: '22:00' })
  })

  it('honours DST (Europe/Madrid summer vs winter)', () => {
    expect(utcToLocalParts('2026-07-15T13:00:00Z', 'Europe/Madrid')).toEqual({ date: '2026-07-15', time: '15:00' })
    expect(utcToLocalParts('2026-01-15T14:00:00Z', 'Europe/Madrid')).toEqual({ date: '2026-01-15', time: '15:00' })
  })

  it('returns empty parts on an invalid/empty ISO instead of throwing', () => {
    // Must not throw: it runs in the fire-and-forget notification path after the
    // DB write already committed.
    expect(utcToLocalParts('', 'America/Bogota')).toEqual({ date: '', time: '' })
    expect(utcToLocalParts('not-a-date', 'America/Bogota')).toEqual({ date: '', time: '' })
  })
})

describe('round-trip local → UTC → local is stable', () => {
  const cases: Array<[string, string, string]> = [
    ['2026-06-10', '15:00', 'America/Bogota'],
    ['2026-06-10', '09:30', 'America/Caracas'],
    ['2026-07-15', '15:00', 'Europe/Madrid'],
    ['2026-01-15', '15:00', 'Europe/Madrid'],
    ['2026-07-15', '12:00', 'America/New_York'],
    ['2026-01-15', '12:00', 'America/New_York'],
  ]
  for (const [date, time, tz] of cases) {
    it(`${date} ${time} @ ${tz}`, () => {
      expect(utcToLocalParts(localToUTC(date, time, tz), tz)).toEqual({ date, time })
    })
  }
})

describe('buildEndISO', () => {
  it('adds the duration in minutes to the start ISO', () => {
    expect(buildEndISO('2026-06-10T20:00:00.000Z', 30)).toBe('2026-06-10T20:30:00.000Z')
    expect(buildEndISO('2026-06-10T20:00:00.000Z', 90)).toBe('2026-06-10T21:30:00.000Z')
  })
})
