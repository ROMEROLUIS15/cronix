import { describe, it, expect } from 'vitest'
import {
  checkEmployeeConflict,
  checkClientConflict,
  checkSlotOverlap,
  evaluateDoubleBooking,
  getLocalDayBoundaries,
  buildAppointmentPayload,
  isExpiredAppointment,
} from './appointments.use-case'

// ── Helpers ──────────────────────────────────────────────────────────────────

const apt = (overrides: {
  start: string
  end: string
  id?: string
  assigned_user_id?: string | null
  client_id?: string
}) => ({
  id:               overrides.id ?? 'apt-1',
  start_at:         overrides.start,
  end_at:           overrides.end,
  assigned_user_id: overrides.assigned_user_id ?? null,
  client_id:        overrides.client_id ?? 'client-1',
})

const d = (iso: string) => new Date(iso)

// ── checkEmployeeConflict ────────────────────────────────────────────────────

describe('checkEmployeeConflict', () => {
  const existing = [
    apt({ start: '2026-03-24T09:00', end: '2026-03-24T11:00', id: 'a1', assigned_user_id: 'emp-1' }),
    apt({ start: '2026-03-24T14:00', end: '2026-03-24T15:00', id: 'a2', assigned_user_id: 'emp-2' }),
  ]

  it('blocks when employee has overlapping appointment', () => {
    const result = checkEmployeeConflict({
      proposedStart: d('2026-03-24T10:00'),
      proposedEnd:   d('2026-03-24T11:30'),
      existing,
      employeeId: 'emp-1',
    })
    expect(result.conflicts).toBe(true)
    expect(result.availableFrom).toBeDefined()
  })

  it('allows when different employee at same time', () => {
    const result = checkEmployeeConflict({
      proposedStart: d('2026-03-24T09:00'),
      proposedEnd:   d('2026-03-24T10:00'),
      existing,
      employeeId: 'emp-2', // emp-2 is free at 9am
    })
    expect(result.conflicts).toBe(false)
  })

  it('allows when same employee at non-overlapping time', () => {
    const result = checkEmployeeConflict({
      proposedStart: d('2026-03-24T11:00'),
      proposedEnd:   d('2026-03-24T12:00'),
      existing,
      employeeId: 'emp-1', // emp-1 is free from 11:00
    })
    expect(result.conflicts).toBe(false)
  })

  it('excludes the current appointment when editing', () => {
    const result = checkEmployeeConflict({
      proposedStart: d('2026-03-24T09:30'),
      proposedEnd:   d('2026-03-24T10:30'),
      existing,
      employeeId: 'emp-1',
      excludeId:  'a1', // editing apt a1 itself
    })
    expect(result.conflicts).toBe(false)
  })

  it('returns availableFrom with end time of conflicting appointment', () => {
    const result = checkEmployeeConflict({
      proposedStart: d('2026-03-24T10:00'),
      proposedEnd:   d('2026-03-24T10:30'),
      existing,
      employeeId: 'emp-1',
    })
    expect(result.conflicts).toBe(true)
    expect(result.availableFrom).toBeTruthy()
    // availableFrom should be the formatted end time of the 9-11 appointment
  })

  it('allows back-to-back appointments (end == start)', () => {
    const result = checkEmployeeConflict({
      proposedStart: d('2026-03-24T11:00'), // exactly when emp-1 finishes
      proposedEnd:   d('2026-03-24T12:00'),
      existing,
      employeeId: 'emp-1',
    })
    expect(result.conflicts).toBe(false)
  })
})

// ── checkClientConflict ──────────────────────────────────────────────────────

describe('checkClientConflict', () => {
  const existing = [
    apt({ start: '2026-03-24T09:00', end: '2026-03-24T11:00', id: 'a1', assigned_user_id: 'emp-1', client_id: 'client-1' }),
    apt({ start: '2026-03-24T14:00', end: '2026-03-24T15:30', id: 'a2', assigned_user_id: 'emp-2', client_id: 'client-2' }),
  ]

  it('blocks when client has overlapping appointment with another employee', () => {
    const result = checkClientConflict({
      proposedStart: d('2026-03-24T10:00'),
      proposedEnd:   d('2026-03-24T11:30'),
      existing,
      clientId: 'client-1',
    })
    expect(result.conflicts).toBe(true)
    expect(result.availableFrom).toBeDefined()
    expect(result.assignedUserId).toBe('emp-1')
  })

  it('allows same client at non-overlapping time (after existing)', () => {
    const result = checkClientConflict({
      proposedStart: d('2026-03-24T11:00'),
      proposedEnd:   d('2026-03-24T12:00'),
      existing,
      clientId: 'client-1',
    })
    expect(result.conflicts).toBe(false)
  })

  it('allows different client at overlapping time', () => {
    const result = checkClientConflict({
      proposedStart: d('2026-03-24T09:30'),
      proposedEnd:   d('2026-03-24T10:30'),
      existing,
      clientId: 'client-2', // client-2 is free at 9am
    })
    expect(result.conflicts).toBe(false)
  })

  it('excludes the current appointment when editing', () => {
    const result = checkClientConflict({
      proposedStart: d('2026-03-24T09:30'),
      proposedEnd:   d('2026-03-24T10:30'),
      existing,
      clientId:   'client-1',
      excludeId:  'a1',
    })
    expect(result.conflicts).toBe(false)
  })

  it('returns assignedUserId of conflicting appointment', () => {
    const result = checkClientConflict({
      proposedStart: d('2026-03-24T14:30'),
      proposedEnd:   d('2026-03-24T15:00'),
      existing,
      clientId: 'client-2',
    })
    expect(result.conflicts).toBe(true)
    expect(result.assignedUserId).toBe('emp-2')
  })

  it('allows back-to-back client appointments (end == start)', () => {
    const result = checkClientConflict({
      proposedStart: d('2026-03-24T11:00'),
      proposedEnd:   d('2026-03-24T12:00'),
      existing,
      clientId: 'client-1',
    })
    expect(result.conflicts).toBe(false)
  })
})

// ── checkSlotOverlap ─────────────────────────────────────────────────────────

describe('checkSlotOverlap', () => {
  const existing = [
    { start_at: '2026-03-24T09:00', end_at: '2026-03-24T10:00', id: 'a1' },
  ]

  it('detects overlap', () => {
    const result = checkSlotOverlap({
      proposedStart: d('2026-03-24T09:30'),
      proposedEnd:   d('2026-03-24T10:30'),
      existing,
    })
    expect(result.overlaps).toBe(true)
  })

  it('no overlap when after', () => {
    const result = checkSlotOverlap({
      proposedStart: d('2026-03-24T10:00'),
      proposedEnd:   d('2026-03-24T11:00'),
      existing,
    })
    expect(result.overlaps).toBe(false)
  })

  it('respects excludeId', () => {
    const result = checkSlotOverlap({
      proposedStart: d('2026-03-24T09:30'),
      proposedEnd:   d('2026-03-24T10:30'),
      existing,
      excludeId: 'a1',
    })
    expect(result.overlaps).toBe(false)
  })
})

// ── evaluateDoubleBooking ────────────────────────────────────────────────────

describe('evaluateDoubleBooking', () => {
  it('returns allowed when no existing appointments', () => {
    const result = evaluateDoubleBooking({ existingCount: 0, existingSlots: [] })
    expect(result.level).toBe('allowed')
  })

  it('returns warn when 1 existing appointment', () => {
    const result = evaluateDoubleBooking({
      existingCount: 1,
      existingSlots: [{ time: '09:00', service: 'Corte' }],
    })
    expect(result.level).toBe('warn')
    expect(result.message).toContain('1 cita')
  })

  it('returns blocked when 2+ existing appointments', () => {
    const result = evaluateDoubleBooking({
      existingCount: 2,
      existingSlots: [
        { time: '09:00', service: 'Corte' },
        { time: '14:00', service: 'Tinte' },
      ],
    })
    expect(result.level).toBe('blocked')
  })
})

// ── getLocalDayBoundaries ────────────────────────────────────────────────────

describe('getLocalDayBoundaries', () => {
  it('returns start and end of day as ISO strings', () => {
    const { start, end } = getLocalDayBoundaries('2026-03-24T14:30')
    // start = local midnight, end = local 23:59:59.999 (ISO may shift day due to timezone)
    const startDate = new Date(start)
    const endDate   = new Date(end)
    expect(startDate.getHours()).toBe(0)
    expect(startDate.getMinutes()).toBe(0)
    expect(endDate.getHours()).toBe(23)
    expect(endDate.getMinutes()).toBe(59)
    // end should be ~24 hours after start
    expect(endDate.getTime() - startDate.getTime()).toBeCloseTo(24 * 60 * 60_000 - 1, -2)
  })
})

// ── buildAppointmentPayload ──────────────────────────────────────────────────

describe('buildAppointmentPayload', () => {
  it('calculates end_at from start + duration', () => {
    const payload = buildAppointmentPayload({
      startAt:          '2026-03-24T09:00:00',
      totalDurationMin: 60,
      clientId:         'c1',
      serviceIds:       ['s1'],
      assignedUserId:   'u1',
      notes:            null,
      businessId:       'b1',
      isDualBooking:    false,
    })

    const startMs = new Date(payload.start_at).getTime()
    const endMs   = new Date(payload.end_at).getTime()
    expect(endMs - startMs).toBe(60 * 60_000) // 60 minutes
    expect(payload.status).toBe('pending')
  })

  it('handles 90-minute service', () => {
    const payload = buildAppointmentPayload({
      startAt:          '2026-03-24T09:00:00',
      totalDurationMin: 90,
      clientId:         'c1',
      serviceIds:       ['s1'],
      assignedUserId:   null,
      notes:            'VIP',
      businessId:       'b1',
      isDualBooking:    true,
    })

    const startMs = new Date(payload.start_at).getTime()
    const endMs   = new Date(payload.end_at).getTime()
    expect(endMs - startMs).toBe(90 * 60_000)
    expect(payload.is_dual_booking).toBe(true)
    expect(payload.assigned_user_id).toBeNull()
  })
})

// ── isExpiredAppointment ─────────────────────────────────────────────────────

describe('isExpiredAppointment', () => {
  it('returns true for past pending appointment', () => {
    expect(isExpiredAppointment({
      end_at: '2020-01-01T10:00:00Z',
      status: 'pending',
    })).toBe(true)
  })

  it('returns false for future appointment', () => {
    expect(isExpiredAppointment({
      end_at: '2099-01-01T10:00:00Z',
      status: 'pending',
    })).toBe(false)
  })

  it('returns false for already completed appointment', () => {
    expect(isExpiredAppointment({
      end_at: '2020-01-01T10:00:00Z',
      status: 'completed',
    })).toBe(false)
  })
})
