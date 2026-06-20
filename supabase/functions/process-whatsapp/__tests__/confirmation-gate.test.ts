/**
 * confirmation-gate.test.ts — Tests for the 2-turn gate + Hybrid Gate.
 *
 * Focuses on:
 *  - toolsAllowedThisTurn (standard 2-turn gate)
 *  - textHasExplicitBookingParams (Hybrid Gate detection)
 */

import { describe, it, expect } from 'vitest'
import { toolsAllowedThisTurn, isAffirmative, lastAssistantWasConfirmation, textHasExplicitBookingParams } from '../confirmation-gate.ts'

// ── textHasExplicitBookingParams ──────────────────────────────────────────────

describe('textHasExplicitBookingParams', () => {
  it('returns true for text with hoy + time', () => {
    expect(textHasExplicitBookingParams('Quiero agendar un corte para hoy a las 3')).toBe(true)
  })

  it('returns true for text with mañana + HH:mm', () => {
    expect(textHasExplicitBookingParams('Agenda para mañana a las 15:00')).toBe(true)
  })

  it('returns true for text with ISO date + HH:mm', () => {
    expect(textHasExplicitBookingParams('Cita para el 2026-06-15 a las 10:30')).toBe(true)
  })

  it('returns true for text with DD/MM + "a las"', () => {
    expect(textHasExplicitBookingParams('Reserva para el 15/06 a las 2:00 PM')).toBe(true)
  })

  it('returns true for text with pasado mañana + time', () => {
    expect(textHasExplicitBookingParams('Pasado mañana a las 11:00')).toBe(true)
  })

  it('returns true for text with fecha literal + "a la" (feminine)', () => {
    expect(textHasExplicitBookingParams('Agenda para el 20 de junio a la 1')).toBe(true)
  })

  it('returns false for text with date but no time', () => {
    expect(textHasExplicitBookingParams('Agenda para mañana')).toBe(false)
  })

  it('returns false for text with time but no date', () => {
    expect(textHasExplicitBookingParams('A las 3:00 PM')).toBe(false)
  })

  it('returns false for empty text', () => {
    expect(textHasExplicitBookingParams('')).toBe(false)
  })

  it('returns false for greeting without params', () => {
    expect(textHasExplicitBookingParams('Hola')).toBe(false)
  })

  it('returns false for cancel intent without params', () => {
    expect(textHasExplicitBookingParams('Quiero cancelar mi cita')).toBe(false)
  })
})

// ── Standard gate functions (sanity) ──────────────────────────────────────────

describe('lastAssistantWasConfirmation', () => {
  it('detects confirm question in last assistant message', () => {
    const hist = [
      { role: 'user', text: 'Quiero un corte' },
      { role: 'model', text: '¿Confirmo tu cita de Corte para el 15 de junio a las 3:00 pm?' },
    ]
    expect(lastAssistantWasConfirmation(hist)).toBe(true)
  })

  it('returns false when last assistant message is not a confirmation', () => {
    const hist = [
      { role: 'user', text: 'Hola' },
      { role: 'model', text: '¿Qué servicio te gustaría?' },
    ]
    expect(lastAssistantWasConfirmation(hist)).toBe(false)
  })

  it('returns false when history is empty', () => {
    expect(lastAssistantWasConfirmation([])).toBe(false)
  })
})

describe('isAffirmative', () => {
  it('detects "sí"', () => expect(isAffirmative('sí')).toBe(true))
  it('detects "si" (without accent)', () => expect(isAffirmative('si')).toBe(true))
  it('detects "dale"', () => expect(isAffirmative('dale')).toBe(true))
  it('detects "ok"', () => expect(isAffirmative('ok')).toBe(true))
  it('detects "confirma"', () => expect(isAffirmative('confirma')).toBe(true))
  it('detects "simón" (regional)', () => expect(isAffirmative('simón')).toBe(true))
  it('detects "sisas" (regional)', () => expect(isAffirmative('sisas')).toBe(true))
  it('rejects "no"', () => expect(isAffirmative('no')).toBe(false))
  it('rejects empty string', () => expect(isAffirmative('')).toBe(false))
  it('rejects text longer than 60 chars', () => {
    expect(isAffirmative('sí '.repeat(30))).toBe(false)
  })
})

describe('toolsAllowedThisTurn', () => {
  it('returns true when last assistant was confirmation and user says yes', () => {
    const hist = [
      { role: 'user', text: 'Quiero un corte' },
      { role: 'model', text: '¿Confirmo tu cita de Corte para el 15 de junio a las 3:00 pm?' },
    ]
    expect(toolsAllowedThisTurn(hist, 'sí')).toBe(true)
  })

  it('returns false when user says no', () => {
    const hist = [
      { role: 'user', text: 'Quiero un corte' },
      { role: 'model', text: '¿Confirmo tu cita de Corte para el 15 de junio a las 3:00 pm?' },
    ]
    expect(toolsAllowedThisTurn(hist, 'no')).toBe(false)
  })

  it('returns false when last assistant was not a confirmation', () => {
    const hist = [
      { role: 'user', text: 'Hola' },
      { role: 'model', text: '¿Qué servicio te gustaría?' },
    ]
    expect(toolsAllowedThisTurn(hist, 'sí')).toBe(false)
  })
})
