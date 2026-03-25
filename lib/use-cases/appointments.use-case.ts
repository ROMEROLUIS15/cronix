/**
 * Appointments Use Case — Pure business logic for appointment operations.
 *
 * NO framework dependencies (no React, no Next.js, no Supabase).
 * Receives data, applies rules, returns results.
 *
 * Exposes:
 *  - evaluateDoubleBooking:     warn/block if client has multiple citas in a day
 *  - checkSlotOverlap:          detect time slot conflicts
 *  - checkClientConflict:       detect client time conflicts across employees
 *  - getLocalDayBoundaries:     timezone-correct date range for queries
 *  - isExpiredAppointment:      check if appointment should auto-resolve
 *  - resolveExpiredAppointments: batch resolve expired from a list
 *  - buildAppointmentPayload:   calculate end_at from start + duration
 */

import type { DoubleBookingLevel, DoubleBookingCheckResult, AppointmentStatus } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────

interface DaySlot {
  time:    string
  service: string
}

interface BookingCheckParams {
  existingCount: number
  existingSlots: DaySlot[]
}

export const DoubleBookingWarningLevel = {
  ALLOWED: 'allowed' as DoubleBookingLevel,
  WARN:    'warn'    as DoubleBookingLevel,
  BLOCKED: 'blocked' as DoubleBookingLevel,
} as const

// ── Double Booking ────────────────────────────────────────────────────────

/**
 * Evaluates whether a client can be booked on a given day.
 * Rule: max 1 extra booking per day (warn), blocked at 2+.
 */
export function evaluateDoubleBooking(
  params: BookingCheckParams
): DoubleBookingCheckResult {
  const { existingCount, existingSlots } = params

  if (existingCount === 0) {
    return {
      level:         'allowed',
      existingCount: 0,
      existingSlots: [],
      message:       '',
    }
  }

  if (existingCount === 1) {
    const slot = existingSlots[0]
    return {
      level:         'warn',
      existingCount: 1,
      existingSlots,
      message:       `Este cliente ya tiene 1 cita ese día${slot ? ` (${slot.time} — ${slot.service})` : ''}. ¿Agregar una segunda cita?`,
    }
  }

  return {
    level:         'blocked',
    existingCount,
    existingSlots,
    message:       `Este cliente ya tiene ${existingCount} citas ese día. Límite de doble agenda alcanzado.`,
  }
}

// ── Slot Overlap ──────────────────────────────────────────────────────────

/**
 * Checks if a proposed time slot overlaps with any existing appointment.
 *
 * Overlap condition:
 *   proposedStart < existingEnd AND proposedEnd > existingStart
 */
export function checkSlotOverlap(params: {
  proposedStart: Date
  proposedEnd:   Date
  existing: Array<{ start_at: string; end_at: string; id?: string }>
  excludeId?:    string
}): { overlaps: boolean; conflictTime?: string } {
  const { proposedStart, proposedEnd, existing, excludeId } = params

  for (const apt of existing) {
    if (excludeId && apt.id === excludeId) continue

    const existStart = new Date(apt.start_at)
    const existEnd   = new Date(apt.end_at)

    const overlaps =
      proposedStart < existEnd &&
      proposedEnd   > existStart

    if (overlaps) {
      return {
        overlaps:    true,
        conflictTime: existStart.toLocaleTimeString('es-CO', {
          hour:   '2-digit',
          minute: '2-digit',
        }),
      }
    }
  }

  return { overlaps: false }
}

// ── Employee Conflict ─────────────────────────────────────────────────────

/**
 * Checks if a specific employee already has a conflicting appointment.
 *
 * Different from checkSlotOverlap: filters ONLY the given employee's
 * appointments before checking overlap. Two different employees CAN
 * have appointments at the same time.
 *
 * Overlap condition:
 *   proposedStart < existingEnd AND proposedEnd > existingStart
 */
export function checkEmployeeConflict(params: {
  proposedStart: Date
  proposedEnd:   Date
  existing: Array<{ start_at: string; end_at: string; id?: string; assigned_user_id?: string | null }>
  employeeId:    string
  excludeId?:    string
}): { conflicts: boolean; conflictTime?: string; availableFrom?: string } {
  const { proposedStart, proposedEnd, existing, employeeId, excludeId } = params
  const fmt = (d: Date) => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

  const employeeApts = existing.filter(
    a => a.assigned_user_id === employeeId && a.id !== excludeId
  )

  for (const apt of employeeApts) {
    const existStart = new Date(apt.start_at)
    const existEnd   = new Date(apt.end_at)

    if (proposedStart < existEnd && proposedEnd > existStart) {
      return {
        conflicts:     true,
        conflictTime:  `${fmt(existStart)} a ${fmt(existEnd)}`,
        availableFrom: fmt(existEnd),
      }
    }
  }

  return { conflicts: false }
}

// ── Client Conflict ──────────────────────────────────────────────────────

/**
 * Checks if a specific client already has a conflicting appointment
 * at the proposed time, regardless of which employee is assigned.
 *
 * Prevents the same client from being booked with two different
 * employees at overlapping times. Different times on the same day = allowed.
 */
export function checkClientConflict(params: {
  proposedStart: Date
  proposedEnd:   Date
  existing: Array<{ start_at: string; end_at: string; id?: string; client_id?: string; assigned_user_id?: string | null }>
  clientId:      string
  excludeId?:    string
}): { conflicts: boolean; conflictTime?: string; availableFrom?: string; assignedUserId?: string | null } {
  const { proposedStart, proposedEnd, existing, clientId, excludeId } = params
  const fmt = (d: Date) => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

  const clientApts = existing.filter(
    a => a.client_id === clientId && a.id !== excludeId
  )

  for (const apt of clientApts) {
    const existStart = new Date(apt.start_at)
    const existEnd   = new Date(apt.end_at)

    if (proposedStart < existEnd && proposedEnd > existStart) {
      return {
        conflicts:      true,
        conflictTime:   `${fmt(existStart)} a ${fmt(existEnd)}`,
        availableFrom:  fmt(existEnd),
        assignedUserId: apt.assigned_user_id ?? null,
      }
    }
  }

  return { conflicts: false }
}

// ── Date Boundaries ───────────────────────────────────────────────────────

/**
 * Returns local day boundaries as ISO strings for range queries.
 * Fixes timezone bug: datetime-local inputs are in local time, not UTC.
 */
export function getLocalDayBoundaries(localDatetimeStr: string): {
  start: string
  end:   string
} {
  const dateStr  = localDatetimeStr.split('T')[0]
  const dayStart = new Date(`${dateStr}T00:00:00`)
  const dayEnd   = new Date(`${dateStr}T23:59:59.999`)
  return {
    start: dayStart.toISOString(),
    end:   dayEnd.toISOString(),
  }
}

// ── Expired Appointment Resolution ────────────────────────────────────────

/**
 * Returns true if the appointment's end_at is in the past
 * and it hasn't been resolved (still pending or confirmed).
 */
export function isExpiredAppointment(apt: {
  end_at: string
  status: string
}): boolean {
  const unresolved = ['pending', 'confirmed']
  return unresolved.includes(apt.status) && new Date(apt.end_at) < new Date()
}

/**
 * Resolves expired appointments in a list by changing their status.
 * Pure function: returns new array, does NOT mutate input.
 */
export function resolveExpiredAppointments<T extends { end_at: string; status: string }>(
  appointments: T[],
  resolvedStatus: AppointmentStatus = 'completed'
): T[] {
  const now = new Date()
  return appointments.map(apt => {
    if (isExpiredAppointment(apt)) {
      return { ...apt, status: resolvedStatus }
    }
    return apt
  })
}

// ── Payload Builder ───────────────────────────────────────────────────────

/**
 * Calculates the end_at from a start time and service duration.
 * Pure function — no side effects.
 */
export interface AppointmentPayload {
  business_id:      string
  client_id:        string
  service_id:       string
  assigned_user_id: string | null
  start_at:         string
  end_at:           string
  notes:            string | null
  status:           'pending'
  is_dual_booking:  boolean
}

export function buildAppointmentPayload(params: {
  startAt: string
  durationMin: number
  clientId: string
  serviceId: string
  assignedUserId: string | null
  notes: string | null
  businessId: string
  isDualBooking: boolean
}): AppointmentPayload {
  const startObj = new Date(params.startAt)
  const endObj   = new Date(startObj.getTime() + params.durationMin * 60_000)

  return {
    business_id:      params.businessId,
    client_id:        params.clientId,
    service_id:       params.serviceId,
    assigned_user_id: params.assignedUserId,
    start_at:         startObj.toISOString(),
    end_at:           endObj.toISOString(),
    notes:            params.notes,
    status:           'pending' as const,
    is_dual_booking:  params.isDualBooking,
  }
}
