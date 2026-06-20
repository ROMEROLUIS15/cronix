/**
 * booking-shared.test.ts — pure precision helpers (closed-day suggestions + cutoff hint).
 */

import { describe, it, expect } from 'vitest'
import { cutoffHint, suggestOpenDays } from '../booking-shared.ts'

const OPEN_MONSAT: Record<string, [string, string] | null> = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'],
  thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: ['09:00', '18:00'], sun: null,
}

describe('cutoffHint', () => {
  it('hints the last slot ONLY when the requested time is past it (service does not fit)', () => {
    expect(cutoffHint('17:00', ['09:00', '15:30', '16:00'])).toMatch(/última cita.*4:00 pm/i)
  })
  it('stays silent when the time is within range or there are no slots', () => {
    expect(cutoffHint('10:00', ['09:00', '15:30', '16:00'])).toBe('')
    expect(cutoffHint('17:00', [])).toBe('')
  })
})

describe('suggestOpenDays', () => {
  it('suggests the next OPEN days, skipping closed ones (Sun)', () => {
    // 2026-06-28 = Sunday (closed) → next open are Mon 29 and Tue 30.
    const s = suggestOpenDays(OPEN_MONSAT, '2026-06-28', 2)
    expect(s).toMatch(/lunes 29 de junio/)
    expect(s).toMatch(/martes 30 de junio/)
    expect(s).toMatch(/ o /)
  })
})
