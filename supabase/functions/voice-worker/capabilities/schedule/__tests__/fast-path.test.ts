import { describe, it, expect } from 'vitest'
import { detectSchedule } from '../fast-path.ts'
import type { CatalogService } from '../../_shared/Capability.ts'

const TODAY = '2026-05-13'   // Wednesday

const SERVICES: CatalogService[] = [
  { id: 's1', name: 'Corte de cabello', duration_min: 45, price: 15 },
  { id: 's2', name: 'Manicure',         duration_min: 30, price: 10 },
  { id: 's3', name: 'Tinte',            duration_min: 90, price: 40 },
]

describe('schedule fast path — happy paths (all 4 params)', () => {
  it('"agéndame a Gardi para corte el lunes a las 3pm"', () => {
    const out = detectSchedule('agéndame a Gardi para corte el lunes a las 3pm', TODAY, SERVICES)
    expect(out).toEqual({
      client_name:  'gardi',
      service_name: 'Corte de cabello',
      date:         '2026-05-18',
      time:         '15:00',
    })
  })

  it('"agenda a Pedro Pérez para manicure mañana a las 10"', () => {
    const out = detectSchedule('agenda a Pedro Pérez para manicure mañana a las 10', TODAY, SERVICES)
    expect(out?.client_name).toBe('pedro perez')
    expect(out?.service_name).toBe('Manicure')
    expect(out?.date).toBe('2026-05-14')
    expect(out?.time).toBe('10:00')
  })

  it('"reserva a María para tinte el 21 de mayo a las 4pm"', () => {
    const out = detectSchedule('reserva a María para tinte el 21 de mayo a las 4pm', TODAY, SERVICES)
    expect(out?.client_name).toBe('maria')
    expect(out?.service_name).toBe('Tinte')
    expect(out?.date).toBe('2026-05-21')
    expect(out?.time).toBe('16:00')
  })

  it('"agéndame a Ana Lopez para corte de cabello pasado mañana a las 9am"', () => {
    const out = detectSchedule('agéndame a Ana Lopez para corte de cabello pasado mañana a las 9am', TODAY, SERVICES)
    expect(out?.client_name).toBe('ana lopez')
    expect(out?.service_name).toBe('Corte de cabello')
    expect(out?.date).toBe('2026-05-15')
    expect(out?.time).toBe('09:00')
  })
})

describe('schedule fast path — returns null when a param is missing', () => {
  it('no time → null', () => {
    expect(detectSchedule('agéndame a Gardi para corte el lunes', TODAY, SERVICES)).toBeNull()
  })
  it('no date → null', () => {
    expect(detectSchedule('agéndame a Gardi para corte a las 3pm', TODAY, SERVICES)).toBeNull()
  })
  it('no service in catalog match → null', () => {
    expect(detectSchedule('agéndame a Gardi para masaje el lunes a las 3pm', TODAY, SERVICES)).toBeNull()
  })
  it('no verb → null', () => {
    expect(detectSchedule('Gardi para corte el lunes a las 3pm', TODAY, SERVICES)).toBeNull()
  })
  it('empty catalog → null', () => {
    expect(detectSchedule('agéndame a Gardi para corte el lunes a las 3pm', TODAY, [])).toBeNull()
  })
})

describe('schedule fast path — guards against false positives', () => {
  it('"qué citas tengo mañana" must not trigger (listing intent)', () => {
    expect(detectSchedule('qué citas tengo mañana', TODAY, SERVICES)).toBeNull()
  })
  it('"reagéndala para mañana a las 4" must not trigger (reschedule, not schedule)', () => {
    expect(detectSchedule('reagéndala para mañana a las 4', TODAY, SERVICES)).toBeNull()
  })
  it('"cancela la cita de Gardi mañana a las 3" must not trigger', () => {
    expect(detectSchedule('cancela la cita de Gardi mañana a las 3', TODAY, SERVICES)).toBeNull()
  })
  it('captured name "mañana" alone must be rejected', () => {
    // No client at all — verb + service + temporal + time, but no human name.
    expect(detectSchedule('agéndame para corte mañana a las 3', TODAY, SERVICES)).toBeNull()
  })
})

describe('schedule fast path — multi-token service names', () => {
  it('"agenda a Luis para corte de cabello el viernes a las 11am" matches the multi-word service', () => {
    const out = detectSchedule('agenda a Luis para corte de cabello el viernes a las 11am', TODAY, SERVICES)
    expect(out?.service_name).toBe('Corte de cabello')
    expect(out?.client_name).toBe('luis')
    expect(out?.date).toBe('2026-05-15')
    expect(out?.time).toBe('11:00')
  })
})
