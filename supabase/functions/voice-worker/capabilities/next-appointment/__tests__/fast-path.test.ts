import { describe, it, expect } from 'vitest'
import { detectNextAppointment } from '../fast-path.ts'

describe('detectNextAppointment fast-path', () => {
  it.each([
    'cuál es mi próxima cita',
    'cual es mi proxima cita',
    '¿cuál es mi siguiente cita?',
    'mi próxima cita',
    'siguiente cita',
    'próximo cliente',
    'qué viene ahora',
    'qué sigue',
    'cuándo es mi próxima',
    'cuál es la próxima cita',
  ])('matches: %s', (text) => {
    expect(detectNextAppointment(text)).toEqual({})
  })

  it.each([
    // date keyword present → let list-appointments handle it
    'cuál es mi próxima cita del viernes',
    'mi próxima cita mañana',
    'próxima cita el 15 de mayo',
    // write intents
    'agéndame una cita',
    'cancela mi próxima cita',
    'reagenda mi siguiente cita',
    // plural "próximas citas" — agenda-style query, not next-in-time
    'cuáles son mis próximas citas',
    // unrelated
    'hola',
    'qué citas tengo hoy',
    'última cita de María',
  ])('rejects: %s', (text) => {
    expect(detectNextAppointment(text)).toBeNull()
  })
})
