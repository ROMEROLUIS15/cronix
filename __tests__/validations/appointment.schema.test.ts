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

  it('debe aceptar input válido', () => {
    const result = CreateAppointmentSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('debe rechazar cuando falta client_id', () => {
    const { client_id: _, ...rest } = validInput
    const result = CreateAppointmentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('debe rechazar cuando end_at es anterior a start_at', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      start_at: new Date('2026-03-20T11:00:00Z'),
      end_at: new Date('2026-03-20T10:00:00Z'),
    })
    expect(result.success).toBe(false)
  })

  it('debe aceptar notas opcionales', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      notes: 'Cita de seguimiento',
    })
    expect(result.success).toBe(true)
  })

  it('debe rechazar business_id no UUID', () => {
    const result = CreateAppointmentSchema.safeParse({
      ...validInput,
      business_id: 'no-es-uuid',
    })
    expect(result.success).toBe(false)
  })
})

describe('UpdateAppointmentSchema', () => {
  it('debe aceptar actualización parcial solo con status', () => {
    const result = UpdateAppointmentSchema.safeParse({ status: 'completed' })
    expect(result.success).toBe(true)
  })

  it('debe rechazar status inválido', () => {
    const result = UpdateAppointmentSchema.safeParse({ status: 'invalid_status' })
    expect(result.success).toBe(false)
  })

  it('debe aceptar cancel_reason opcional', () => {
    const result = UpdateAppointmentSchema.safeParse({
      status: 'cancelled',
      cancel_reason: 'No disponible',
    })
    expect(result.success).toBe(true)
  })
})
