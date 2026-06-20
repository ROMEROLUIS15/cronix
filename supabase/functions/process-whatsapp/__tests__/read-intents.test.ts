/**
 * read-intents.test.ts — list-appointments query (RC4) + DB_ERROR mapping (RC2b).
 */

import { describe, it, expect } from 'vitest'
import { isListAppointmentsQuery, buildAppointmentsListResponse } from '../read-intents.ts'
import { selectFinalResponse } from '../final-response.ts'

const TZ = 'America/Caracas'

describe('isListAppointmentsQuery', () => {
  it('detects appointment queries', () => {
    expect(isListAppointmentsQuery('¿tengo alguna cita?')).toBe(true)
    expect(isListAppointmentsQuery('quiero saber si tengo cita disponible')).toBe(true)
    expect(isListAppointmentsQuery('cuándo es mi cita')).toBe(true)
    expect(isListAppointmentsQuery('ver mis citas')).toBe(true)
  })
  it('detects plural / natural phrasings (the real failing inputs)', () => {
    expect(isListAppointmentsQuery('quiero saber si tengo citas disponibles')).toBe(true)
    expect(isListAppointmentsQuery('tengo citas')).toBe(true)
    expect(isListAppointmentsQuery('qué citas tengo')).toBe(true)
    expect(isListAppointmentsQuery('cuáles son mis citas')).toBe(true)
    expect(isListAppointmentsQuery('mis citas pendientes')).toBe(true)
  })
  it('does NOT fire on write flows or availability queries', () => {
    expect(isListAppointmentsQuery('quiero agendar una cita')).toBe(false)
    expect(isListAppointmentsQuery('cancela mi cita')).toBe(false)
    expect(isListAppointmentsQuery('reagenda mi cita')).toBe(false)
    expect(isListAppointmentsQuery('qué horarios tienes disponible')).toBe(false)
  })
})

describe('buildAppointmentsListResponse', () => {
  it('handles no active appointments', () => {
    expect(buildAppointmentsListResponse([], TZ)).toMatch(/no tienes ninguna cita/i)
  })
  it('lists active appointments with service, date and time', () => {
    const r = buildAppointmentsListResponse(
      [{ service_name: 'Tarjeta', start_at: '2026-06-20T13:00:00Z' }], // 09:00 Caracas
      TZ,
    )
    expect(r).toContain('Tarjeta')
    expect(r).toMatch(/9:00/)
    expect(r).toMatch(/junio/i)
    expect(r).toMatch(/esta cita activa/i)
  })
  it('pluralizes the header for multiple appointments', () => {
    const r = buildAppointmentsListResponse(
      [
        { service_name: 'Tarjeta', start_at: '2026-06-20T13:00:00Z' },
        { service_name: 'Corte',   start_at: '2026-06-21T14:00:00Z' },
      ],
      TZ,
    )
    expect(r).toMatch(/2 citas activas/i)
  })
})

describe('selectFinalResponse DB_ERROR mapping (RC2b)', () => {
  it('maps DB_ERROR to a retry/alternative message, not the opaque generic', () => {
    const r = selectFinalResponse(true, { success: false, error: 'DB_ERROR' }, '', { tool: 'confirm_booking' }, TZ)
    expect(r).toMatch(/problema técnico/i)
    expect(r).not.toMatch(/intenta de nuevo en unos minutos/i)
  })
})
