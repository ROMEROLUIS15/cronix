import { describe, it, expect } from 'vitest'
import { detectReschedule } from '../fast-path.ts'

const TODAY = '2026-05-13'  // Wednesday
const LAST_REF = { clientName: 'Gardi Suárez' }

describe('reschedule fast path — anaphoric (uses lastRef)', () => {
  it('"reagéndala para mañana a las 5pm" → uses lastRef client + new date+time', () => {
    const out = detectReschedule('reagéndala para mañana a las 5pm', TODAY, LAST_REF)
    expect(out).toEqual({ client_name: 'Gardi Suárez', new_date: '2026-05-14', new_time: '17:00' })
  })
  it('"reagéndamela para el viernes" → only date changes', () => {
    const out = detectReschedule('reagéndamela para el viernes', TODAY, LAST_REF)
    expect(out).toEqual({ client_name: 'Gardi Suárez', new_date: '2026-05-15', new_time: undefined })
  })
  it('"muévela a las 4pm" → only time changes', () => {
    const out = detectReschedule('muévela a las 4pm', TODAY, LAST_REF)
    expect(out).toEqual({ client_name: 'Gardi Suárez', new_date: undefined, new_time: '16:00' })
  })
  it('"cámbiala para mañana"', () => {
    const out = detectReschedule('cámbiala para mañana', TODAY, LAST_REF)
    expect(out?.client_name).toBe('Gardi Suárez')
    expect(out?.new_date).toBe('2026-05-14')
  })
  it('"sí, reagéndala para el sábado" — confirmation prefix accepted', () => {
    const out = detectReschedule('sí, reagéndala para el sábado', TODAY, LAST_REF)
    expect(out?.new_date).toBe('2026-05-16')
  })
})

describe('reschedule fast path — explicit client', () => {
  it('"reagenda a Pedro Pérez para mañana a las 3pm"', () => {
    const out = detectReschedule('reagenda a Pedro Pérez para mañana a las 3pm', TODAY, null)
    expect(out?.client_name).toBe('pedro perez')
    expect(out?.new_date).toBe('2026-05-14')
    expect(out?.new_time).toBe('15:00')
  })
  it('"reagenda la cita de María para el 21 de mayo"', () => {
    const out = detectReschedule('reagenda la cita de María para el 21 de mayo', TODAY, null)
    expect(out?.client_name).toBe('maria')
    expect(out?.new_date).toBe('2026-05-21')
  })
})

describe('reschedule fast path — non-matches', () => {
  it('anaphoric verb without lastRef → null', () => {
    expect(detectReschedule('reagéndala para mañana', TODAY, null)).toBeNull()
  })
  it('verb without date or time → null', () => {
    expect(detectReschedule('reagéndala', TODAY, LAST_REF)).toBeNull()
  })
  it('plain greeting → null', () => {
    expect(detectReschedule('hola luis', TODAY, LAST_REF)).toBeNull()
  })
  it('listing intent without reschedule verb → null', () => {
    expect(detectReschedule('qué citas tengo mañana', TODAY, LAST_REF)).toBeNull()
  })
})
