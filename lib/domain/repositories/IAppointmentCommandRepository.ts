/**
 * IAppointmentCommandRepository — WRITE-side of CQRS for appointments.
 *
 * Exposes: all mutation operations for appointments.
 * Does NOT expose: queries (getMonthAppointments, findConflicts, etc.)
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { CreateAppointmentPayload } from './IAppointmentRepository'

export interface IAppointmentCommandRepository {
  /**
   * Creates a new appointment (with multi-service support).
   */
  create(payload: CreateAppointmentPayload): Promise<Result<{
    id:          string
    business_id: string
    client_id:   string
    status:      string
  }>>

  /**
   * Updates appointment status.
   * Requires businessId for cache invalidation (avoids extra DB round-trip).
   */
  updateStatus(
    appointmentId: string,
    status: string,
    businessId: string
  ): Promise<Result<void>>

  /**
   * Reschedules an appointment to a new time slot.
   * Requires businessId for cache invalidation (avoids extra DB round-trip).
   */
  reschedule(
    appointmentId: string,
    startAt: string,
    endAt: string,
    businessId: string
  ): Promise<Result<void>>
}
