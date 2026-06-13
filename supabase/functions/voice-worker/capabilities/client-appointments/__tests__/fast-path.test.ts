import { describe, it, expect } from 'vitest'
import { detectClientAppointments } from '../fast-path.ts'

const TODAY = '2026-06-12'
const SERVICES = [
  { id: 'svc-1', name: 'Corte', duration_min: 30, price: 10 },
  { id: 'svc-2', name: 'Tinte de cabello', duration_min: 90, price: 40 },
]

describe('detectClientAppointments — positives', () => {
  it('"qué citas tiene Ana"', () => {
    expect(detectClientAppointments('qué citas tiene Ana', TODAY)).toEqual({ client_name: 'ana' })
  })

  it('"qué citas tiene la clienta Ana Torres" (descriptor stripped)', () => {
    expect(detectClientAppointments('qué citas tiene la clienta Ana Torres', TODAY))
      .toEqual({ client_name: 'ana torres' })
  })

  it('"citas de María"', () => {
    expect(detectClientAppointments('dame las citas de María', TODAY)).toEqual({ client_name: 'maria' })
  })

  it('"próxima cita de Ana" (client target, not global next)', () => {
    expect(detectClientAppointments('cuál es la próxima cita de Ana', TODAY)).toEqual({ client_name: 'ana' })
  })

  it('"cuándo viene Lisset"', () => {
    expect(detectClientAppointments('cuándo viene Lisset', TODAY)).toEqual({ client_name: 'lisset' })
  })
})

describe('detectClientAppointments — negatives (routing)', () => {
  it('"qué citas tengo mañana" → list-appointments (no 3rd-person target)', () => {
    expect(detectClientAppointments('qué citas tengo mañana', TODAY)).toBeNull()
  })

  it('"citas de mañana" → date word as name rejected', () => {
    expect(detectClientAppointments('las citas de mañana', TODAY)).toBeNull()
  })

  it('"citas del viernes" expressed as "citas de viernes" → date rejected', () => {
    expect(detectClientAppointments('citas de viernes', TODAY)).toBeNull()
  })

  it('"reagenda la cita de Ana para el lunes" → write verb blocks', () => {
    expect(detectClientAppointments('reagenda la cita de Ana para el lunes', TODAY)).toBeNull()
  })

  it('"cancela la cita de Ana" → write verb blocks', () => {
    expect(detectClientAppointments('cancela la cita de Ana', TODAY)).toBeNull()
  })

  it('"última cita de Ana" → last-visit intent (past)', () => {
    expect(detectClientAppointments('cuál fue la última cita de Ana', TODAY)).toBeNull()
  })

  it('"próxima cita de corte" → service name, not a client', () => {
    expect(detectClientAppointments('próxima cita de corte', TODAY, SERVICES)).toBeNull()
  })

  it('"cita de tinte de cabello" → multi-word service rejected', () => {
    expect(detectClientAppointments('cuál es la cita de tinte', TODAY, SERVICES)).toBeNull()
  })
})
