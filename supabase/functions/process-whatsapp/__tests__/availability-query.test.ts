/**
 * availability-query.test.ts — deterministic "¿qué horarios hay…?" resolver.
 * Lists REAL slots (never invents); asks for the day or service when missing.
 */

import { describe, it, expect } from 'vitest'
import { resolveAvailabilityQuery } from '../availability-query.ts'

const TZ = 'America/Bogota'
const ONE_SVC = [{ id: 'svc-t', name: 'Tarjeta', duration_min: 30 }]
const OPEN_ALL: Record<string, [string, string]> = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'],
  thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: ['09:00', '18:00'], sun: ['09:00', '18:00'],
}

describe('resolveAvailabilityQuery', () => {
  it('asks for the day when no date is given', () => {
    const r = resolveAvailabilityQuery({ userText: 'qué horarios hay', services: ONE_SVC, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [] })
    expect(r).toMatch(/para qué día/i)
  })

  it('lists real free slots for a date + single service (never invents)', () => {
    const r = resolveAvailabilityQuery({ userText: 'qué horarios hay el 25 de diciembre', services: ONE_SVC, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [] })
    expect(r).toMatch(/25 de diciembre/)
    expect(r).toMatch(/9:00 am/)
    expect(r).toMatch(/Tarjeta/)
  })

  it('reports a closed day instead of inventing slots', () => {
    const closed: Record<string, [string, string] | null> = { ...OPEN_ALL, fri: null }
    // 2026-12-25 is a Friday
    const r = resolveAvailabilityQuery({ userText: 'qué horarios hay el 25 de diciembre', services: ONE_SVC, workingHours: closed, timezone: TZ, bookedSlots: [] })
    expect(r).toMatch(/cerrad/i)
  })

  it('asks which service when there are several (nudges into booking)', () => {
    const many = [{ id: 'a', name: 'Tarjeta', duration_min: 30 }, { id: 'b', name: 'Electrónica', duration_min: 60 }]
    const r = resolveAvailabilityQuery({ userText: 'qué horarios hay el 25 de diciembre', services: many, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [] })
    expect(r).toMatch(/para qué servicio/i)
    expect(r).toMatch(/Tarjeta, Electrónica/)
  })
})
