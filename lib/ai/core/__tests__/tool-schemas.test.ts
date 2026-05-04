/**
 * tool-schemas.test.ts — Zod schema validation tests (valid + adversarial).
 * Critical: these schemas are the first line of defense against malformed LLM output.
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
} from '../contracts/tool-schemas'

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const VALID_DATE = '2026-05-10'
const VALID_TIME = '15:00'

// ── ConfirmBookingSchema ──────────────────────────────────────────────────────

describe('ConfirmBookingSchema', () => {
  it('accepts valid booking with client_name', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        VALID_DATE,
      time:        VALID_TIME,
      client_name: 'Ana García',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid booking with client_id (UUID)', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id: VALID_UUID,
      date:       VALID_DATE,
      time:       VALID_TIME,
      client_id:  VALID_UUID,
    })
    expect(result.success).toBe(true)
  })

  it('accepts long compound name (Juan Pérez Gómez)', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'corte',
      date:        VALID_DATE,
      time:        '10:00',
      client_name: 'Juan Pérez Gómez',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional staff_id', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'corte',
      date:        VALID_DATE,
      time:        VALID_TIME,
      client_name: 'Ana',
      staff_id:    VALID_UUID,
    })
    expect(result.success).toBe(true)
  })

  // ── Adversarial ────────────────────────────────────────────────────────────

  it('REJECTS when neither client_name nor client_id present', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id: 'manicura',
      date:       VALID_DATE,
      time:       VALID_TIME,
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid time format "25:99"', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        VALID_DATE,
      time:        '25:99',
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('HH:mm')
  })

  it('REJECTS time in 12h format "3 PM" (LLM must convert first)', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        VALID_DATE,
      time:        '3 PM',
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid date format "05/10/2026"', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        '05/10/2026',
      time:        VALID_TIME,
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS date "2026-13-01" (month 13)', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        '2026-13-01',
      time:        VALID_TIME,
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS date "2026-05-00" (day 0)', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        '2026-05-00',
      time:        VALID_TIME,
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid UUID in client_id', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        VALID_DATE,
      time:        VALID_TIME,
      client_id:   'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid UUID in staff_id', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'manicura',
      date:        VALID_DATE,
      time:        VALID_TIME,
      client_name: 'Ana',
      staff_id:    'invalid-uuid-format',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS empty service_id', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  '',
      date:        VALID_DATE,
      time:        VALID_TIME,
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS missing required fields', () => {
    expect(ConfirmBookingSchema.safeParse({}).success).toBe(false)
    expect(ConfirmBookingSchema.safeParse({ service_id: 'x' }).success).toBe(false)
    expect(ConfirmBookingSchema.safeParse({ service_id: 'x', date: VALID_DATE }).success).toBe(false)
  })

  it('REJECTS time "24:00" (boundary)', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id:  'corte',
      date:        VALID_DATE,
      time:        '24:00',
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })
})

// ── CancelBookingSchema ───────────────────────────────────────────────────────

describe('CancelBookingSchema', () => {
  it('accepts appointment_id form', () => {
    const result = CancelBookingSchema.safeParse({ appointment_id: VALID_UUID })
    expect(result.success).toBe(true)
  })

  it('accepts client_name form', () => {
    const result = CancelBookingSchema.safeParse({ client_name: 'Ana García' })
    expect(result.success).toBe(true)
  })

  it('accepts client_name + date + time form', () => {
    const result = CancelBookingSchema.safeParse({
      client_name: 'Ana García',
      date:        VALID_DATE,
      time:        VALID_TIME,
    })
    expect(result.success).toBe(true)
  })

  it('REJECTS appointment_id that is not a UUID', () => {
    const result = CancelBookingSchema.safeParse({ appointment_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('REJECTS empty object', () => {
    const result = CancelBookingSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid time in client_name form', () => {
    const result = CancelBookingSchema.safeParse({
      client_name: 'Ana',
      time: '25:00',
    })
    expect(result.success).toBe(false)
  })
})

// ── RescheduleBookingSchema ───────────────────────────────────────────────────

describe('RescheduleBookingSchema', () => {
  it('accepts appointment_id + new_date + new_time', () => {
    const result = RescheduleBookingSchema.safeParse({
      appointment_id: VALID_UUID,
      new_date:       VALID_DATE,
      new_time:       '16:00',
    })
    expect(result.success).toBe(true)
  })

  it('accepts client_name + new_date + new_time', () => {
    const result = RescheduleBookingSchema.safeParse({
      client_name: 'Ana García',
      new_date:    VALID_DATE,
      new_time:    '10:30',
    })
    expect(result.success).toBe(true)
  })

  it('REJECTS missing new_date', () => {
    const result = RescheduleBookingSchema.safeParse({
      appointment_id: VALID_UUID,
      new_time:       '16:00',
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS missing new_time', () => {
    const result = RescheduleBookingSchema.safeParse({
      appointment_id: VALID_UUID,
      new_date:       VALID_DATE,
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid new_time "3 PM"', () => {
    const result = RescheduleBookingSchema.safeParse({
      client_name: 'Ana',
      new_date:    VALID_DATE,
      new_time:    '3 PM',
    })
    expect(result.success).toBe(false)
  })
})

// ── GetAvailableSlotsSchema ───────────────────────────────────────────────────

describe('GetAvailableSlotsSchema', () => {
  it('accepts valid date + duration', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: VALID_DATE, duration_min: 30 })
    expect(result.success).toBe(true)
  })

  it('accepts min duration 5 minutes', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: VALID_DATE, duration_min: 5 })
    expect(result.success).toBe(true)
  })

  it('accepts max duration 480 minutes (8h)', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: VALID_DATE, duration_min: 480 })
    expect(result.success).toBe(true)
  })

  it('REJECTS duration below 5', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: VALID_DATE, duration_min: 4 })
    expect(result.success).toBe(false)
  })

  it('REJECTS duration above 480', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: VALID_DATE, duration_min: 481 })
    expect(result.success).toBe(false)
  })

  it('REJECTS non-integer duration', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: VALID_DATE, duration_min: 30.5 })
    expect(result.success).toBe(false)
  })

  it('REJECTS invalid date', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: '2026/05/10', duration_min: 30 })
    expect(result.success).toBe(false)
  })
})

// ── GetByDateSchema ───────────────────────────────────────────────────────────

describe('GetByDateSchema', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(GetByDateSchema.safeParse({ date: VALID_DATE }).success).toBe(true)
  })

  it('REJECTS invalid date formats', () => {
    expect(GetByDateSchema.safeParse({ date: '2026/05/10' }).success).toBe(false)
    expect(GetByDateSchema.safeParse({ date: 'today' }).success).toBe(false)
    expect(GetByDateSchema.safeParse({ date: '' }).success).toBe(false)
    expect(GetByDateSchema.safeParse({}).success).toBe(false)
  })
})

// ── CreateClientSchema ────────────────────────────────────────────────────────

describe('CreateClientSchema', () => {
  it('accepts name only', () => {
    expect(CreateClientSchema.safeParse({ name: 'Ana García' }).success).toBe(true)
  })

  it('accepts name + phone', () => {
    const result = CreateClientSchema.safeParse({ name: 'Ana', phone: '+58 424 123 4567' })
    expect(result.success).toBe(true)
  })

  it('accepts very long name (120 chars)', () => {
    const result = CreateClientSchema.safeParse({ name: 'A'.repeat(120) })
    expect(result.success).toBe(true)
  })

  it('accepts compound name with accents "Juan Pérez Gómez"', () => {
    const result = CreateClientSchema.safeParse({ name: 'Juan Pérez Gómez' })
    expect(result.success).toBe(true)
  })

  it('REJECTS empty name', () => {
    expect(CreateClientSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('REJECTS name > 120 chars', () => {
    const result = CreateClientSchema.safeParse({ name: 'A'.repeat(121) })
    expect(result.success).toBe(false)
  })

  it('REJECTS missing name', () => {
    expect(CreateClientSchema.safeParse({}).success).toBe(false)
    expect(CreateClientSchema.safeParse({ phone: '123' }).success).toBe(false)
  })
})

// ── SearchClientsSchema ───────────────────────────────────────────────────────

describe('SearchClientsSchema', () => {
  it('accepts 2+ character query', () => {
    expect(SearchClientsSchema.safeParse({ query: 'An' }).success).toBe(true)
    expect(SearchClientsSchema.safeParse({ query: 'Ana García' }).success).toBe(true)
  })

  it('REJECTS 1-character query', () => {
    expect(SearchClientsSchema.safeParse({ query: 'A' }).success).toBe(false)
  })

  it('REJECTS empty query', () => {
    expect(SearchClientsSchema.safeParse({ query: '' }).success).toBe(false)
  })

  it('REJECTS query > 80 chars', () => {
    const result = SearchClientsSchema.safeParse({ query: 'A'.repeat(81) })
    expect(result.success).toBe(false)
  })
})
