import { describe, it, expect } from 'vitest'
import { detectListAppointments } from '../fast-path.ts'

const TODAY = '2026-05-13'  // Wednesday

describe('list-appointments fast path — read intents', () => {
  it('"qué citas tengo hoy" → today', () => {
    expect(detectListAppointments('qué citas tengo hoy', TODAY)?.date).toBe('2026-05-13')
  })
  it('"qué citas tengo mañana" → +1', () => {
    expect(detectListAppointments('qué citas tengo mañana', TODAY)?.date).toBe('2026-05-14')
  })
  it('"qué citas tengo pasado mañana" → +2', () => {
    expect(detectListAppointments('qué citas tengo pasado mañana', TODAY)?.date).toBe('2026-05-15')
  })
  it('"qué citas tengo el 21 de mayo" → absolute', () => {
    expect(detectListAppointments('qué citas tengo el 21 de mayo', TODAY)?.date).toBe('2026-05-21')
  })
  it('"muéstrame las citas del próximo viernes" → +2', () => {
    expect(detectListAppointments('muéstrame las citas del próximo viernes', TODAY)?.date).toBe('2026-05-15')
  })
  it('"agenda de hoy" — noun "agenda", not the verb', () => {
    expect(detectListAppointments('agenda de hoy', TODAY)?.date).toBe('2026-05-13')
  })
  it('"qué tengo mañana"', () => {
    expect(detectListAppointments('qué tengo mañana', TODAY)?.date).toBe('2026-05-14')
  })
  it('"cuáles son mis citas el viernes"', () => {
    expect(detectListAppointments('cuáles son mis citas el viernes', TODAY)?.date).toBe('2026-05-15')
  })
  it('"citas para el sábado"', () => {
    expect(detectListAppointments('citas para el sábado', TODAY)?.date).toBe('2026-05-16')
  })
  it('"citas en 3 días"', () => {
    expect(detectListAppointments('citas en 3 días', TODAY)?.date).toBe('2026-05-16')
  })
  // Colloquial "clientes" used as synonym for "citas" when asking the agenda.
  it('"qué clientes tengo mañana" → +1', () => {
    expect(detectListAppointments('qué clientes tengo mañana', TODAY)?.date).toBe('2026-05-14')
  })
  it('"qué clientes tengo para mañana" → +1', () => {
    expect(detectListAppointments('qué clientes tengo para mañana', TODAY)?.date).toBe('2026-05-14')
  })
  it('"cuántos clientes tengo hoy" → today', () => {
    expect(detectListAppointments('cuántos clientes tengo hoy', TODAY)?.date).toBe('2026-05-13')
  })
  it('"clientes para mañana" → +1', () => {
    expect(detectListAppointments('clientes para mañana', TODAY)?.date).toBe('2026-05-14')
  })
})

describe('list-appointments fast path — non-matches', () => {
  it('no query keyword → null', () => {
    expect(detectListAppointments('hola luis', TODAY)).toBeNull()
  })
  it('query keyword without date → null', () => {
    expect(detectListAppointments('qué citas tengo', TODAY)).toBeNull()
  })
  it('write verb "agéndame" → null even if date present', () => {
    expect(detectListAppointments('agéndame mañana a las 3', TODAY)).toBeNull()
  })
  it('write verb "cancela" → null', () => {
    expect(detectListAppointments('cancela la cita de mañana', TODAY)).toBeNull()
  })
  it('write verb "borra" → null', () => {
    expect(detectListAppointments('borra la cita de hoy', TODAY)).toBeNull()
  })
  it('write verb "reagenda" → null', () => {
    expect(detectListAppointments('reagenda la cita para mañana', TODAY)).toBeNull()
  })
  it('write verb "elimina" → null', () => {
    expect(detectListAppointments('elimina al cliente luis', TODAY)).toBeNull()
  })
})
