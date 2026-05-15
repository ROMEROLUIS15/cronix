import { describe, it, expect } from 'vitest'
import { detectLastVisit } from '../fast-path.ts'

describe('detectLastVisit — happy paths', () => {
  it('"cuándo fue la última vez que atendí a Ada Monsalve"', () => {
    expect(detectLastVisit('cuándo fue la última vez que atendí a Ada Monsalve')?.client_name).toBe('ada monsalve')
  })
  it('"última vez que vino Luis"', () => {
    expect(detectLastVisit('última vez que vino Luis')?.client_name).toBe('luis')
  })
  it('"última cita de María Pérez"', () => {
    expect(detectLastVisit('última cita de María Pérez')?.client_name).toBe('maría pérez')
  })
  it('"última visita de Pedro"', () => {
    expect(detectLastVisit('última visita de Pedro')?.client_name).toBe('pedro')
  })
  it('"cuándo vino Ana"', () => {
    expect(detectLastVisit('cuándo vino Ana')?.client_name).toBe('ana')
  })
  it('"cuándo vino Ana por última vez"', () => {
    expect(detectLastVisit('cuándo vino Ana por última vez')?.client_name).toBe('ana')
  })
  it('"qué día fue la última vez que atendí a Gardi Suárez"', () => {
    expect(detectLastVisit('qué día fue la última vez que atendí a Gardi Suárez')?.client_name).toBe('gardi suárez')
  })
  it('"dime cuándo vino Luis"', () => {
    expect(detectLastVisit('dime cuándo vino Luis')?.client_name).toBe('luis')
  })
  it('"dime la última visita de Luis"', () => {
    expect(detectLastVisit('dime la última visita de Luis')?.client_name).toBe('luis')
  })
  it('handles trailing question mark', () => {
    expect(detectLastVisit('última cita de Pedro?')?.client_name).toBe('pedro')
  })
})

describe('detectLastVisit — rejects write intents', () => {
  it('"agenda a Luis para corte mañana a las 3"', () => {
    expect(detectLastVisit('agenda a Luis para corte mañana a las 3')).toBeNull()
  })
  it('"reagéndala para mañana"', () => {
    expect(detectLastVisit('reagéndala para mañana')).toBeNull()
  })
  it('"cancela la cita de Luis"', () => {
    expect(detectLastVisit('cancela la cita de Luis')).toBeNull()
  })
  it('"elimina a Luis"', () => {
    expect(detectLastVisit('elimina a Luis')).toBeNull()
  })
})

describe('detectLastVisit — guard against noise', () => {
  it('"qué citas tengo mañana" → null', () => {
    expect(detectLastVisit('qué citas tengo mañana')).toBeNull()
  })
  it('"hola, cómo estás" → null', () => {
    expect(detectLastVisit('hola, cómo estás')).toBeNull()
  })
  it('"última vez que vino mañana" → null (noise-only name)', () => {
    expect(detectLastVisit('última vez que vino mañana')).toBeNull()
  })
})
