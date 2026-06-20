/**
 * availability.test.ts — Deterministic free-slot math (computeAvailableSlots).
 *
 * Note: textHasTime and resolveBookingTimeGap were removed — the booking state
 * machine (booking-flow.ts) now owns date-without-time, so those overlapping
 * helpers were dead code. Their behaviour is covered by booking-flow.test.ts and
 * datetime-nlu.test.ts.
 */

import { describe, it, expect } from 'vitest'
import { computeAvailableSlots, type WorkingHours } from '../availability.ts'

const TZ = 'America/Caracas' // UTC-4, no DST

function weekdayOf(dateISO: string): string {
  // 3-letter lowercase key (mon/tue/…), matching the dashboard's workingHours.
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TZ })
    .format(new Date(`${dateISO}T12:00:00Z`)).toLowerCase().slice(0, 3)
}

describe('computeAvailableSlots', () => {
  it('defaults to 09:00–18:00 when working_hours is null (18 × 30-min slots)', () => {
    const r = computeAvailableSlots({ workingHours: null, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: [], nowMs: 0 })
    expect(r.open).toBe(true)
    expect(r.slots[0]).toBe('09:00')
    expect(r.slots).toContain('17:30')
    expect(r.slots).not.toContain('18:00') // 18:00 + 30 would end after close
    expect(r.slots.length).toBe(18)
  })

  it('excludes a slot that overlaps a booked appointment', () => {
    // 09:00 local in Caracas (UTC-4) = 13:00Z
    const booked = [{ start_at: '2026-06-20T13:00:00Z', end_at: '2026-06-20T13:30:00Z' }]
    const r = computeAvailableSlots({ workingHours: null, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: booked, nowMs: 0 })
    expect(r.slots).not.toContain('09:00')
    expect(r.slots).toContain('09:30')
  })

  it('returns open:false for an explicitly closed weekday', () => {
    const day = weekdayOf('2026-06-20')
    const wh: WorkingHours = { [day]: null }
    const r = computeAvailableSlots({ workingHours: wh, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: [], nowMs: 0 })
    expect(r.open).toBe(false)
    expect(r.slots).toEqual([])
  })

  it('respects custom hours and the must-end-by-close invariant', () => {
    const day = weekdayOf('2026-06-20')
    const wh: WorkingHours = { [day]: ['10:00', '12:00'] }
    const r = computeAvailableSlots({ workingHours: wh, date: '2026-06-20', timezone: TZ, durationMin: 60, bookedSlots: [], nowMs: 0 })
    expect(r.slots).toEqual(['10:00', '10:30', '11:00']) // 11:30+60 ends 12:30 > close
  })

  it('drops slots already in the PAST for a same-day booking (never offers an earlier hour)', () => {
    // 14:00 Caracas (UTC-4) on 2026-06-20 = 18:00Z → everything up to 14:00 is past.
    const nowMs = Date.parse('2026-06-20T18:00:00Z')
    const r = computeAvailableSlots({ workingHours: null, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: [], nowMs })
    expect(r.open).toBe(true)
    expect(r.slots).not.toContain('09:00')
    expect(r.slots).not.toContain('13:30')
    expect(r.slots[0]).toBe('14:30') // 14:00 == now → excluded (<=), next free is 14:30
  })

  it('does NOT trim anything for a FUTURE date (now is well before every slot)', () => {
    const nowMs = Date.parse('2026-06-20T18:00:00Z')
    const r = computeAvailableSlots({ workingHours: null, date: '2026-12-25', timezone: TZ, durationMin: 30, bookedSlots: [], nowMs })
    expect(r.slots[0]).toBe('09:00')
    expect(r.slots.length).toBe(18)
  })
})
