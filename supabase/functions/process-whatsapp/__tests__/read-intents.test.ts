/**
 * read-intents.test.ts — list-appointments query (RC4) + DB_ERROR mapping (RC2b).
 */

import { describe, it, expect } from 'vitest'
import { isListAppointmentsQuery, buildAppointmentsListResponse, isServicesQuery, isAvailabilityQuery, isLocationQuery, isHoursQuery } from '../read-intents.ts'
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

describe('isServicesQuery', () => {
  it('detects catalog / pricing questions', () => {
    for (const t of ['qué servicios tienen', 'que servicios tienen disponibles?', 'qué ofrecen',
                     'cuánto cuesta', 'cuanto cuesta Tarjeta', 'qué precios manejan', 'lista de servicios']) {
      expect(isServicesQuery(t)).toBe(true)
    }
  })
  it('does NOT fire on booking, availability or small talk', () => {
    expect(isServicesQuery('quiero agendar una cita')).toBe(false)
    expect(isServicesQuery('qué horarios hay el martes')).toBe(false)
    expect(isServicesQuery('hola')).toBe(false)
  })
})

describe('isAvailabilityQuery', () => {
  it('detects standalone availability questions', () => {
    for (const t of ['qué horarios hay el martes', 'horarios disponibles', 'tienes algo disponible mañana',
                     'a qué horas atienden', 'qué disponibilidad hay']) {
      expect(isAvailabilityQuery(t)).toBe(true)
    }
  })
  it('does NOT fire when a write verb is present (booking owns it) or on services', () => {
    expect(isAvailabilityQuery('agéndame el martes, qué horarios hay')).toBe(false)
    expect(isAvailabilityQuery('qué servicios tienen')).toBe(false)
    expect(isAvailabilityQuery('hola')).toBe(false)
  })
})

describe('isLocationQuery', () => {
  it('detects location/address questions', () => {
    for (const t of ['dónde están ubicados', 'cuál es la dirección', 'cómo llego', 'en qué zona están', 'su ubicación']) {
      expect(isLocationQuery(t)).toBe(true)
    }
  })
  it('does NOT fire on booking or hours', () => {
    expect(isLocationQuery('quiero agendar')).toBe(false)
    expect(isLocationQuery('a qué hora abren')).toBe(false)
  })
})

describe('isHoursQuery', () => {
  it('detects schedule questions', () => {
    for (const t of ['a qué hora abren', 'qué días trabajan', 'cuál es su horario', 'están abiertos hoy', 'hasta qué hora atienden']) {
      expect(isHoursQuery(t)).toBe(true)
    }
  })
  it('does NOT fire on availability-for-booking, location or write verbs', () => {
    expect(isHoursQuery('qué horarios hay el martes')).toBe(false) // availability, not schedule
    expect(isHoursQuery('dónde están')).toBe(false)
    expect(isHoursQuery('agéndame mañana')).toBe(false)
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
