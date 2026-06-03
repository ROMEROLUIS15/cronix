/**
 * time-utils.test.ts — DST / timezone round-trip guards (WhatsApp channel).
 *
 * `utcToLocalParts` feeds `emitCancelledEvent`'s human-readable date/time; the
 * audit hardened it against an empty `start_at`. `localTimeToUTC` converts the
 * agreed wall time to the stored UTC instant. These tests pin both across
 * fixed-offset and DST zones.
 */

import { describe, it, expect } from 'vitest'
import { localTimeToUTC, utcToLocalParts } from '../time-utils.ts'

describe('localTimeToUTC — local wall time → UTC ISO', () => {
  it('fixed offset −05 (America/Bogota): 15:00 local → 20:00Z', () => {
    expect(localTimeToUTC('2026-06-10', '15:00', 'America/Bogota')).toBe('2026-06-10T20:00:00.000Z')
  })

  it('crosses the date boundary: 22:00 Bogota → 03:00Z next day', () => {
    expect(localTimeToUTC('2026-06-10', '22:00', 'America/Bogota')).toBe('2026-06-11T03:00:00.000Z')
  })

  it('DST-aware (Europe/Madrid): 15:00 local maps to different UTC by season', () => {
    expect(localTimeToUTC('2026-07-15', '15:00', 'Europe/Madrid')).toBe('2026-07-15T13:00:00.000Z') // CEST +02
    expect(localTimeToUTC('2026-01-15', '15:00', 'Europe/Madrid')).toBe('2026-01-15T14:00:00.000Z') // CET  +01
  })
})

describe('utcToLocalParts — UTC ISO → business-local {date, time}', () => {
  it('renders the LOCAL hour, not the UTC slice', () => {
    expect(utcToLocalParts('2026-06-10T20:00:00Z', 'America/Bogota')).toEqual({ date: '2026-06-10', time: '15:00' })
  })

  it('rolls the date back when local is the previous day', () => {
    expect(utcToLocalParts('2026-06-11T03:00:00Z', 'America/Bogota')).toEqual({ date: '2026-06-10', time: '22:00' })
  })

  it('returns empty parts on an invalid/empty ISO instead of throwing', () => {
    // emitCancelledEvent may pass '' when the original start_at can't be recovered;
    // it must not throw in the fire-and-forget notification path.
    expect(utcToLocalParts('', 'America/Bogota')).toEqual({ date: '', time: '' })
    expect(utcToLocalParts('not-a-date', 'America/Bogota')).toEqual({ date: '', time: '' })
  })
})

describe('round-trip local → UTC → local is stable', () => {
  const cases: Array<[string, string, string]> = [
    ['2026-06-10', '15:00', 'America/Bogota'],
    ['2026-07-15', '15:00', 'Europe/Madrid'],
    ['2026-01-15', '15:00', 'Europe/Madrid'],
    ['2026-07-15', '12:00', 'America/New_York'],
  ]
  for (const [date, time, tz] of cases) {
    it(`${date} ${time} @ ${tz}`, () => {
      expect(utcToLocalParts(localTimeToUTC(date, time, tz), tz)).toEqual({ date, time })
    })
  }
})
