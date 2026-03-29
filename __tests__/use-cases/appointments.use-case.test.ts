import { describe, it, expect } from 'vitest'
import {
  evaluateDoubleBooking,
  checkSlotOverlap,
  getLocalDayBoundaries,
  isExpiredAppointment,
  resolveExpiredAppointments,
  buildAppointmentPayload,
} from '@/lib/use-cases/appointments.use-case'

// ── evaluateDoubleBooking ─────────────────────────────────────────────────

describe('evaluateDoubleBooking', () => {
  it('debe retornar allowed cuando no hay citas previas', () => {
    const result = evaluateDoubleBooking({ existingCount: 0, existingSlots: [] })
    expect(result.level).toBe('allowed')
    expect(result.existingCount).toBe(0)
    expect(result.message).toBe('')
  })

  it('debe retornar warn cuando el cliente tiene 1 cita ese día', () => {
    const result = evaluateDoubleBooking({
      existingCount: 1,
      existingSlots: [{ time: '10:00', service: 'Corte' }],
    })
    expect(result.level).toBe('warn')
    expect(result.existingCount).toBe(1)
    expect(result.message).toContain('ya tiene 1 cita')
    expect(result.message).toContain('10:00')
    expect(result.message).toContain('Corte')
  })

  it('debe retornar blocked cuando el cliente tiene 2 o más citas ese día', () => {
    const result = evaluateDoubleBooking({
      existingCount: 3,
      existingSlots: [
        { time: '09:00', service: 'Corte' },
        { time: '11:00', service: 'Tinte' },
        { time: '14:00', service: 'Manicure' },
      ],
    })
    expect(result.level).toBe('blocked')
    expect(result.existingCount).toBe(3)
    expect(result.message).toContain('3 citas')
  })

  it('debe retornar warn con mensaje genérico si slot está vacío', () => {
    const result = evaluateDoubleBooking({
      existingCount: 1,
      existingSlots: [],
    })
    expect(result.level).toBe('warn')
    expect(result.message).toContain('ya tiene 1 cita')
  })
})

// ── checkSlotOverlap ──────────────────────────────────────────────────────

describe('checkSlotOverlap', () => {
  const existing = [
    { start_at: '2026-03-20T10:00:00Z', end_at: '2026-03-20T11:00:00Z', id: 'a1' },
    { start_at: '2026-03-20T14:00:00Z', end_at: '2026-03-20T15:00:00Z', id: 'a2' },
  ]

  it('debe retornar no overlap cuando el slot está libre', () => {
    const result = checkSlotOverlap({
      proposedStart: new Date('2026-03-20T12:00:00Z'),
      proposedEnd:   new Date('2026-03-20T13:00:00Z'),
      existing,
    })
    expect(result.overlaps).toBe(false)
  })

  it('debe detectar solapamiento cuando el slot propuesto empieza dentro de uno existente', () => {
    const result = checkSlotOverlap({
      proposedStart: new Date('2026-03-20T10:30:00Z'),
      proposedEnd:   new Date('2026-03-20T11:30:00Z'),
      existing,
    })
    expect(result.overlaps).toBe(true)
    expect(result.conflictTime).toBeDefined()
  })

  it('debe detectar solapamiento cuando el slot propuesto termina dentro de uno existente', () => {
    const result = checkSlotOverlap({
      proposedStart: new Date('2026-03-20T09:30:00Z'),
      proposedEnd:   new Date('2026-03-20T10:30:00Z'),
      existing,
    })
    expect(result.overlaps).toBe(true)
  })

  it('debe detectar solapamiento cuando el slot propuesto contiene uno existente', () => {
    const result = checkSlotOverlap({
      proposedStart: new Date('2026-03-20T09:00:00Z'),
      proposedEnd:   new Date('2026-03-20T12:00:00Z'),
      existing,
    })
    expect(result.overlaps).toBe(true)
  })

  it('debe excluir un appointment por ID', () => {
    const result = checkSlotOverlap({
      proposedStart: new Date('2026-03-20T10:30:00Z'),
      proposedEnd:   new Date('2026-03-20T11:30:00Z'),
      existing,
      excludeId: 'a1',
    })
    expect(result.overlaps).toBe(false)
  })

  it('no debe detectar overlap con slots adyacentes (back-to-back)', () => {
    const result = checkSlotOverlap({
      proposedStart: new Date('2026-03-20T11:00:00Z'),
      proposedEnd:   new Date('2026-03-20T12:00:00Z'),
      existing,
    })
    expect(result.overlaps).toBe(false)
  })
})

// ── getLocalDayBoundaries ─────────────────────────────────────────────────

describe('getLocalDayBoundaries', () => {
  it('debe retornar start y end como ISO strings con start < end y span ~24h', () => {
    const { start, end } = getLocalDayBoundaries('2026-03-20T14:30')
    const startDate = new Date(start)
    const endDate = new Date(end)

    // start must be before end
    expect(startDate.getTime()).toBeLessThan(endDate.getTime())
    // span should be ~24 hours (86399999 ms = 23h 59m 59.999s)
    const spanMs = endDate.getTime() - startDate.getTime()
    expect(spanMs).toBe(86399999)
    // Both must be valid ISO strings
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('debe generar boundaries consistentes para cualquier hora del mismo día', () => {
    const a = getLocalDayBoundaries('2026-01-01T00:00')
    const b = getLocalDayBoundaries('2026-01-01T23:59')
    // Same day input → same boundaries
    expect(a.start).toBe(b.start)
    expect(a.end).toBe(b.end)
  })
})

// ── isExpiredAppointment ──────────────────────────────────────────────────

describe('isExpiredAppointment', () => {
  it('debe retornar true para cita pending con end_at en el pasado', () => {
    const result = isExpiredAppointment({
      end_at: '2020-01-01T00:00:00Z',
      status: 'pending',
    })
    expect(result).toBe(true)
  })

  it('debe retornar true para cita confirmed con end_at en el pasado', () => {
    const result = isExpiredAppointment({
      end_at: '2020-01-01T00:00:00Z',
      status: 'confirmed',
    })
    expect(result).toBe(true)
  })

  it('debe retornar false para cita pending con end_at en el futuro', () => {
    const result = isExpiredAppointment({
      end_at: '2099-01-01T00:00:00Z',
      status: 'pending',
    })
    expect(result).toBe(false)
  })

  it('debe retornar false para cita ya resuelta (completed)', () => {
    const result = isExpiredAppointment({
      end_at: '2020-01-01T00:00:00Z',
      status: 'completed',
    })
    expect(result).toBe(false)
  })

  it('debe retornar false para cita cancelada', () => {
    const result = isExpiredAppointment({
      end_at: '2020-01-01T00:00:00Z',
      status: 'cancelled',
    })
    expect(result).toBe(false)
  })
})

// ── resolveExpiredAppointments ────────────────────────────────────────────

describe('resolveExpiredAppointments', () => {
  it('debe resolver citas expiradas sin mutar el array original', () => {
    const input = [
      { end_at: '2020-01-01T00:00:00Z', status: 'pending', id: '1' },
      { end_at: '2099-01-01T00:00:00Z', status: 'pending', id: '2' },
    ]
    const result = resolveExpiredAppointments(input)

    expect(result[0]!.status).toBe('completed')
    expect(result[1]!.status).toBe('pending')
    // Original not mutated
    expect(input[0]!.status).toBe('pending')
  })
})

// ── buildAppointmentPayload ──────────────────────────────────────────────

describe('buildAppointmentPayload', () => {
  it('debe calcular end_at correctamente a partir de duration', () => {
    const payload = buildAppointmentPayload({
      startAt: '2026-03-20T10:00:00Z',
      totalDurationMin: 30,
      clientId: 'c1',
      serviceIds: ['s1'],
      assignedUserId: 'u1',
      notes: 'Test',
      businessId: 'b1',
      isDualBooking: false,
    })

    expect(payload.end_at).toBe(new Date('2026-03-20T10:30:00Z').toISOString())
    expect(payload.start_at).toBe(new Date('2026-03-20T10:00:00Z').toISOString())
    expect(payload.status).toBe('pending')
    expect(payload.business_id).toBe('b1')
    expect(payload.is_dual_booking).toBe(false)
  })

  it('debe manejar notes null correctamente', () => {
    const payload = buildAppointmentPayload({
      startAt: '2026-03-20T10:00:00Z',
      totalDurationMin: 60,
      clientId: 'c1',
      serviceIds: ['s1'],
      assignedUserId: null,
      notes: null,
      businessId: 'b1',
      isDualBooking: true,
    })

    expect(payload.notes).toBeNull()
    expect(payload.assigned_user_id).toBeNull()
    expect(payload.is_dual_booking).toBe(true)
    expect(payload.end_at).toBe(new Date('2026-03-20T11:00:00Z').toISOString())
  })
})
