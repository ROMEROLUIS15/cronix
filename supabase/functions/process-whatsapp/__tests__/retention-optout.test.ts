/**
 * retention-optout.test.ts — STOP detection (modulo-retencion §8).
 *
 * Pure-function guard: must catch genuine opt-out phrasings while NEVER firing
 * on appointment cancellation ("cancelar cita") or normal booking intent.
 */

import { describe, it, expect } from 'vitest'
import { isOptOutRequest } from '../retention-optout.ts'

describe('isOptOutRequest — true cases', () => {
  const optOuts = [
    'STOP',
    'stop.',
    'baja',
    'Quiero darme de baja',
    'no me escriban más por favor',
    'No me manden mensajes',
    'no me envíen más promociones',
    'ya no quiero mensajes',
    'no quiero recibir más mensajes',
    'no más mensajes',
    'dejen de escribirme',
    'deja de molestar',
    'cancelar suscripción',
    'no me contacten más',
    'unsubscribe',
  ]

  for (const msg of optOuts) {
    it(`detects: "${msg}"`, () => {
      expect(isOptOutRequest(msg)).toBe(true)
    })
  }
})

describe('isOptOutRequest — false cases (no collision with booking)', () => {
  const normal = [
    'quiero cancelar mi cita',
    'cancelar cita de mañana',
    'necesito reagendar',
    'hola, quiero agendar un corte',
    '¿qué servicios tienen?',
    'cuánto cuesta la barba',
    'gracias, nos vemos',
    'no puedo asistir mañana',
  ]

  for (const msg of normal) {
    it(`ignores: "${msg}"`, () => {
      expect(isOptOutRequest(msg)).toBe(false)
    })
  }
})
