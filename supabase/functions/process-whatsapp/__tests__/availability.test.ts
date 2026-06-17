/**
 * availability.test.ts — Deterministic slot resolver (RC1 anti-hallucination).
 *
 * Covers computeAvailableSlots (free-slot math), textHasTime, and
 * resolveBookingTimeGap (the date-without-time → real-slots reply that
 * replaces the 8B inventing a time).
 */

import { describe, it, expect } from 'vitest'
import { computeAvailableSlots, textHasTime, resolveBookingTimeGap, type WorkingHours } from '../availability.ts'

const TZ = 'America/Caracas' // UTC-4, no DST

function weekdayOf(dateISO: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TZ })
    .format(new Date(`${dateISO}T12:00:00Z`)).toLowerCase()
}

function tomorrowISO(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + 1)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

describe('computeAvailableSlots', () => {
  it('defaults to 09:00–18:00 when working_hours is null (18 × 30-min slots)', () => {
    const r = computeAvailableSlots({ workingHours: null, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: [] })
    expect(r.open).toBe(true)
    expect(r.slots[0]).toBe('09:00')
    expect(r.slots).toContain('17:30')
    expect(r.slots).not.toContain('18:00') // 18:00 + 30 would end after close
    expect(r.slots.length).toBe(18)
  })

  it('excludes a slot that overlaps a booked appointment', () => {
    // 09:00 local in Caracas (UTC-4) = 13:00Z
    const booked = [{ start_at: '2026-06-20T13:00:00Z', end_at: '2026-06-20T13:30:00Z' }]
    const r = computeAvailableSlots({ workingHours: null, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: booked })
    expect(r.slots).not.toContain('09:00')
    expect(r.slots).toContain('09:30')
  })

  it('returns open:false for an explicitly closed weekday', () => {
    const day = weekdayOf('2026-06-20')
    const wh: WorkingHours = { [day]: null }
    const r = computeAvailableSlots({ workingHours: wh, date: '2026-06-20', timezone: TZ, durationMin: 30, bookedSlots: [] })
    expect(r.open).toBe(false)
    expect(r.slots).toEqual([])
  })

  it('respects custom hours and the must-end-by-close invariant', () => {
    const day = weekdayOf('2026-06-20')
    const wh: WorkingHours = { [day]: { open: '10:00', close: '12:00' } }
    const r = computeAvailableSlots({ workingHours: wh, date: '2026-06-20', timezone: TZ, durationMin: 60, bookedSlots: [] })
    expect(r.slots).toEqual(['10:00', '10:30', '11:00']) // 11:30+60 ends 12:30 > close
  })
})

describe('textHasTime', () => {
  it('detects explicit times', () => {
    expect(textHasTime('a las 9')).toBe(true)
    expect(textHasTime('9 am')).toBe(true)
    expect(textHasTime('15:30')).toBe(true)
    expect(textHasTime('mañana a las 3 de la tarde')).toBe(true)
  })
  it('returns false when no time is present', () => {
    expect(textHasTime('para el 20 de junio')).toBe(false)
    expect(textHasTime('sí, mañana')).toBe(false)
  })
})

describe('resolveBookingTimeGap', () => {
  const oneService = [{ id: 's1', name: 'Tarjeta', duration_min: 30 }]

  it('lists real slots (never invents) when date given without a time', () => {
    const r = resolveBookingTimeGap({
      userText: 'sí, para mañana', isBookingContext: true,
      services: oneService, workingHours: null, timezone: TZ, bookedSlots: [],
    })
    expect(r).not.toBeNull()
    expect(r).toContain('Tarjeta')
    expect(r).toMatch(/horarios libres|a qué hora/i)
    expect(r).not.toMatch(/3:00 pm/i) // the old hallucination
  })

  it('proposes the single remaining slot as a confirmation question', () => {
    const day = weekdayOf(tomorrowISO())
    const wh: WorkingHours = { [day]: { open: '09:00', close: '09:30' } }
    const r = resolveBookingTimeGap({
      userText: 'sí, para mañana', isBookingContext: true,
      services: [{ id: 's1', name: 'Corte', duration_min: 30 }], workingHours: wh, timezone: TZ, bookedSlots: [],
    })
    expect(r).toMatch(/^¿Confirmo/)
    expect(r).toContain('Corte')
  })

  it('falls through (null) when the client already gave a time', () => {
    expect(resolveBookingTimeGap({
      userText: 'mañana a las 3 pm', isBookingContext: true,
      services: oneService, workingHours: null, timezone: TZ, bookedSlots: [],
    })).toBeNull()
  })

  it('falls through (null) outside a booking context', () => {
    expect(resolveBookingTimeGap({
      userText: 'para el 20 de junio', isBookingContext: false,
      services: oneService, workingHours: null, timezone: TZ, bookedSlots: [],
    })).toBeNull()
  })

  it('falls through (null) for cancel/reschedule intents', () => {
    expect(resolveBookingTimeGap({
      userText: 'cancela mi cita de mañana', isBookingContext: true,
      services: oneService, workingHours: null, timezone: TZ, bookedSlots: [],
    })).toBeNull()
  })

  it('falls through (null) when the service is ambiguous (multi-service, none named)', () => {
    expect(resolveBookingTimeGap({
      userText: 'para mañana', isBookingContext: true,
      services: [{ id: 's1', name: 'Corte', duration_min: 30 }, { id: 's2', name: 'Color', duration_min: 60 }],
      workingHours: null, timezone: TZ, bookedSlots: [],
    })).toBeNull()
  })
})
