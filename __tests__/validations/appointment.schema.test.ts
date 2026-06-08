import { describe, it, expect } from 'vitest'
import {
  CreateAppointmentSchema,
  UpdateAppointmentSchema,
} from '@/lib/validations/appointment.schema'

describe('CreateAppointmentSchema', () => {
  const validInput = {
    business_id: '550e8400-e29b-41d4-a716-446655440000',
    client_id: '550e8400-e29b-41d4-a716-446655440001',
    service_ids: ['550e8400-e29b-41d4-a716-446655440002'],
    start_at: new Date('2026-03-20T10:00:00Z'),
    end_at: new Date('2026-03-20T11:00:00Z'),
  }

  it('accepts valid input', () => {
    const result = CreateAppointmentSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects when client_id is missing', () => {
    const { client_id: _, ...rest } = validInput
    const result = CreateAppointmentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects when business_id is missing', () => {
    const { business_id: _, ...rest } = validInput
    const result = CreateAppointmentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects when service_ids is empty', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      service_ids: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects when end_at is before start_at', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      start_at: new Date('2026-03-20T11:00:00Z'),
      end_at: new Date('2026-03-20T10:00:00Z'),
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID business_id', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      business_id: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional notes', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      notes: 'Follow-up appointment',
    })
    expect(result.success).toBe(true)
  })

  it('rejects notes exceeding 500 characters', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      notes: 'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional assigned_user_id', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      assigned_user_id: '550e8400-e29b-41d4-a716-446655440010',
    })
    expect(result.success).toBe(true)
  })

  it('defaults confirmDouble to false when omitted', () => {
    const result = CreateAppointmentSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.confirmDouble).toBe(false)
    }
  })
})

describe('UpdateAppointmentSchema', () => {
  it('accepts partial update with just status', () => {
    const result = UpdateAppointmentSchema.safeParse({ status: 'completed' })
    expect(result.success).toBe(true)
  })

  it('accepts empty body (all fields optional)', () => {
    const result = UpdateAppointmentSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const result = UpdateAppointmentSchema.safeParse({ status: 'invalid_status' })
    expect(result.success).toBe(false)
  })

  it('accepts optional cancel_reason', () => {
    const result = UpdateAppointmentSchema.safeParse({
      status: 'cancelled',
      cancel_reason: 'Client unavailable',
    })
    expect(result.success).toBe(true)
  })

  it('rejects cancel_reason exceeding 200 characters', () => {
    const result = UpdateAppointmentSchema.safeParse({
      status: 'cancelled',
      cancel_reason: 'x'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('rejects end_at before start_at on partial update', () => {
    const result = UpdateAppointmentSchema.safeParse({
      start_at: new Date('2026-03-20T11:00:00Z'),
      end_at: new Date('2026-03-20T10:00:00Z'),
    })
    expect(result.success).toBe(false)
  })
})
