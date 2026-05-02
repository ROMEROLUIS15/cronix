/**
 * tool-schemas.test.ts — Validación de schemas Zod canónicos.
 *
 * Coverage:
 *   HHmm / ISODate — regexes corregidas (bugs del audit)
 *   ConfirmBookingSchema — requiere client_name O client_id
 *   CancelBookingSchema — union: por UUID o por nombre
 *   RescheduleBookingSchema — campos obligatorios
 *
 * Estos tests verifican directamente los fixes del audit:
 *   - "25:99" ahora es inválido (antes pasaba)
 *   - "2026-13-01" ahora es inválido (antes pasaba)
 *   - ConfirmBooking sin client_name ni client_id → falla
 */

import { describe, it, expect } from 'vitest'
import {
  ConfirmBookingSchema,
  CancelBookingSchema,
  RescheduleBookingSchema,
  GetAvailableSlotsSchema,
  GetByDateSchema,
  CreateClientSchema,
  SearchClientsSchema,
} from '@/lib/ai/core/contracts/tool-schemas'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SVC_UUID = '11111111-1111-4111-8111-111111111111'
const CLI_UUID = '22222222-2222-4222-8222-222222222222'
const APT_UUID = '33333333-3333-4333-8333-333333333333'

function valid(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new Error(`Expected valid but got: ${JSON.stringify((r as any).error?.issues)}`)
  }
  return r
}

function invalid(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) {
  const r = schema.safeParse(value)
  if (r.success) {
    throw new Error(`Expected invalid but got success for: ${JSON.stringify(value)}`)
  }
  return r
}

// ── HHmm (validación de hora) — fix crítico del audit ────────────────────────

describe('HHmm regex — validación correcta post-fix', () => {
  // Válidos
  it('acepta "00:00"', () => valid(GetByDateSchema.shape ? { safeParse: (v) => ConfirmBookingSchema.safeParse({ service_id: 'X', date: '2026-05-03', time: v as string, client_name: 'Ana' }) } : GetAvailableSlotsSchema, '2026-05-03'))

  // Los tests de HHmm se hacen a través de ConfirmBookingSchema
  const baseValid = { service_id: 'Manicura', date: '2026-05-03', client_name: 'Ana García' }

  it('acepta "00:00"', () => valid(ConfirmBookingSchema, { ...baseValid, time: '00:00' }))
  it('acepta "09:30"', () => valid(ConfirmBookingSchema, { ...baseValid, time: '09:30' }))
  it('acepta "15:00"', () => valid(ConfirmBookingSchema, { ...baseValid, time: '15:00' }))
  it('acepta "23:59"', () => valid(ConfirmBookingSchema, { ...baseValid, time: '23:59' }))

  // Inválidos — estos PASABAN antes del fix, ahora deben fallar
  it('rechaza "25:00" — hora imposible', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '25:00' }))
  it('rechaza "24:00" — fuera de rango', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '24:00' }))
  it('rechaza "25:99" — completamente inválido', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '25:99' }))
  it('rechaza "9:00" — sin padding', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '9:00' }))
  it('rechaza "15:60" — minutos > 59', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '15:60' }))
  it('rechaza "3 PM" — formato sin normalizar', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '3 PM' }))
  it('rechaza string vacío', () => invalid(ConfirmBookingSchema, { ...baseValid, time: '' }))
})

// ── ISODate (validación de fecha) — fix del audit ────────────────────────────

describe('ISODate regex — validación correcta post-fix', () => {
  const baseValid = { service_id: 'Manicura', time: '10:00', client_name: 'Ana García' }

  it('acepta "2026-05-03"', () => valid(ConfirmBookingSchema, { ...baseValid, date: '2026-05-03' }))
  it('acepta "2026-01-01"', () => valid(ConfirmBookingSchema, { ...baseValid, date: '2026-01-01' }))
  it('acepta "2026-12-31"', () => valid(ConfirmBookingSchema, { ...baseValid, date: '2026-12-31' }))

  // Estos PASABAN antes del fix
  it('rechaza "2026-13-01" — mes 13', () => invalid(ConfirmBookingSchema, { ...baseValid, date: '2026-13-01' }))
  it('rechaza "2026-00-01" — mes 0', () => invalid(ConfirmBookingSchema, { ...baseValid, date: '2026-00-01' }))
  it('rechaza "2026-05-32" — día 32', () => invalid(ConfirmBookingSchema, { ...baseValid, date: '2026-05-32' }))
  it('rechaza "2026-05-00" — día 0', () => invalid(ConfirmBookingSchema, { ...baseValid, date: '2026-05-00' }))
  it('rechaza formato sin guiones', () => invalid(ConfirmBookingSchema, { ...baseValid, date: '20260503' }))
  it('rechaza "mañana" como fecha', () => invalid(ConfirmBookingSchema, { ...baseValid, date: 'mañana' }))
})

// ── ConfirmBookingSchema ──────────────────────────────────────────────────────

describe('ConfirmBookingSchema', () => {
  it('válido con client_name', () => {
    valid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      date: '2026-05-03',
      time: '10:00',
      client_name: 'Ana García',
    })
  })

  it('válido con client_id (UUID)', () => {
    valid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      date: '2026-05-03',
      time: '10:00',
      client_id: CLI_UUID,
    })
  })

  it('válido con ambos client_name y client_id', () => {
    valid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      date: '2026-05-03',
      time: '10:00',
      client_name: 'Ana García',
      client_id: CLI_UUID,
    })
  })

  it('válido con service_id como nombre (no UUID)', () => {
    valid(ConfirmBookingSchema, {
      service_id: 'Manicura',
      date: '2026-05-03',
      time: '10:00',
      client_name: 'Ana García',
    })
  })

  // BUG fix del audit: fast-path D enviaba args sin client_name → este schema debe rechazarlo
  it('inválido sin client_name NI client_id — el refine falla', () => {
    invalid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      date: '2026-05-03',
      time: '10:00',
    })
  })

  it('inválido sin service_id', () => {
    invalid(ConfirmBookingSchema, {
      date: '2026-05-03',
      time: '10:00',
      client_name: 'Ana',
    })
  })

  it('inválido sin date', () => {
    invalid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      time: '10:00',
      client_name: 'Ana',
    })
  })

  it('inválido sin time', () => {
    invalid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      date: '2026-05-03',
      client_name: 'Ana',
    })
  })

  it('client_id vacío no satisface el refine', () => {
    // client_id: "" → UUID.safeParse("") falla → el campo no está → refine falla
    invalid(ConfirmBookingSchema, {
      service_id: SVC_UUID,
      date: '2026-05-03',
      time: '10:00',
      client_id: 'not-a-uuid',
    })
  })
})

// ── CancelBookingSchema ───────────────────────────────────────────────────────

describe('CancelBookingSchema', () => {
  it('válido con appointment_id UUID', () => {
    valid(CancelBookingSchema, { appointment_id: APT_UUID })
  })

  it('válido con client_name', () => {
    valid(CancelBookingSchema, { client_name: 'Ana García' })
  })

  it('válido con client_name + date', () => {
    valid(CancelBookingSchema, { client_name: 'Ana García', date: '2026-05-03' })
  })

  it('inválido con appointment_id no-UUID', () => {
    invalid(CancelBookingSchema, { appointment_id: 'no-es-uuid' })
  })

  it('inválido con client_name vacío', () => {
    invalid(CancelBookingSchema, { client_name: '' })
  })

  it('inválido sin ningún campo', () => {
    // Ninguna rama de la unión se satisface
    invalid(CancelBookingSchema, {})
  })
})

// ── RescheduleBookingSchema ───────────────────────────────────────────────────

describe('RescheduleBookingSchema', () => {
  it('válido con appointment_id + nueva fecha/hora', () => {
    valid(RescheduleBookingSchema, {
      appointment_id: APT_UUID,
      new_date: '2026-05-10',
      new_time: '11:00',
    })
  })

  it('válido con client_name + nueva fecha/hora', () => {
    valid(RescheduleBookingSchema, {
      client_name: 'Ana García',
      new_date: '2026-05-10',
      new_time: '11:00',
    })
  })

  it('inválido sin new_date', () => {
    invalid(RescheduleBookingSchema, {
      appointment_id: APT_UUID,
      new_time: '11:00',
    })
  })

  it('inválido sin new_time', () => {
    invalid(RescheduleBookingSchema, {
      appointment_id: APT_UUID,
      new_date: '2026-05-10',
    })
  })

  it('inválido con new_time fuera de rango', () => {
    invalid(RescheduleBookingSchema, {
      appointment_id: APT_UUID,
      new_date: '2026-05-10',
      new_time: '25:00',
    })
  })
})

// ── GetAvailableSlotsSchema ───────────────────────────────────────────────────

describe('GetAvailableSlotsSchema', () => {
  it('válido', () => valid(GetAvailableSlotsSchema, { date: '2026-05-03', duration_min: 45 }))
  it('inválido con duration_min = 0 (min es 5)', () => invalid(GetAvailableSlotsSchema, { date: '2026-05-03', duration_min: 0 }))
  it('inválido con duration_min = 481 (max es 480)', () => invalid(GetAvailableSlotsSchema, { date: '2026-05-03', duration_min: 481 }))
  it('inválido sin date', () => invalid(GetAvailableSlotsSchema, { duration_min: 30 }))
})

// ── CreateClientSchema ────────────────────────────────────────────────────────

describe('CreateClientSchema', () => {
  it('válido con solo name', () => valid(CreateClientSchema, { name: 'Ana García' }))
  it('válido con name y phone', () => valid(CreateClientSchema, { name: 'Ana García', phone: '+57 300 123 4567' }))
  it('inválido con name vacío', () => invalid(CreateClientSchema, { name: '' }))
  it('inválido sin name', () => invalid(CreateClientSchema, {}))
})

// ── SearchClientsSchema ───────────────────────────────────────────────────────

describe('SearchClientsSchema', () => {
  it('válido con query de 2+ caracteres', () => valid(SearchClientsSchema, { query: 'An' }))
  it('válido con query larga', () => valid(SearchClientsSchema, { query: 'Juan Pérez Gómez' }))
  it('inválido con query de 1 carácter', () => invalid(SearchClientsSchema, { query: 'A' }))
  it('inválido con query vacío', () => invalid(SearchClientsSchema, { query: '' }))
  it('inválido con query de 81 chars (max 80)', () => invalid(SearchClientsSchema, { query: 'A'.repeat(81) }))
})
