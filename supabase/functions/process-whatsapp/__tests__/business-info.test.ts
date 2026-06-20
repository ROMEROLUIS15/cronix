/**
 * business-info.test.ts — deterministic location/hours answers (never invented).
 */

import { describe, it, expect } from 'vitest'
import { buildLocationResponse, buildHoursResponse } from '../business-info.ts'

const WH = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'],
  thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: ['09:00', '18:00'], sun: null,
} as Record<string, [string, string] | null>

describe('buildLocationResponse', () => {
  it('uses the REAL address when present', () => {
    expect(buildLocationResponse({ name: 'IGM', address: 'Calle 5 #10-20, Caracas' })).toMatch(/Calle 5 #10-20, Caracas/)
  })
  it('says it does not have it — never invents a street', () => {
    const r = buildLocationResponse({ name: 'IGM', address: null })
    expect(r).toMatch(/no tengo registrada/i)
    expect(r).not.toMatch(/\bcalle\b|\bavenida\b|\b#\d/i)
  })
})

describe('buildHoursResponse', () => {
  it('groups consecutive equal days into a range and marks the closed day', () => {
    const r = buildHoursResponse(WH, 'IGM')
    expect(r).toMatch(/Lunes a sábado: de 9:00 am a 6:00 pm/)
    expect(r).toMatch(/Domingo: cerrado/)
  })
  it('falls back to a sane default when hours are unconfigured', () => {
    expect(buildHoursResponse(null, 'IGM')).toMatch(/lunes a sábado/i)
  })
})
