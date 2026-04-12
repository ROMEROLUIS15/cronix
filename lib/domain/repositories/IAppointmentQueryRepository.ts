/**
 * IAppointmentQueryRepository — READ-side of CQRS for appointments.
 *
 * Exposes: all read-only queries for appointments.
 * Does NOT expose: mutations (create, update, reschedule, etc.)
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { AppointmentWithRelations, SlotCheckAppointment } from '@/types'

// ── Shared types (primarily read-side) ───────────────────────────────────────

export type AiApptRow = {
  id: string
  start_at: string
  services: { name: string; duration_min: number } | null
  service_id: string | null
  assigned_user_id: string | null
}

export type AppointmentDateRange = {
  id: string
  start_at: string
  end_at: string
  status: string
}

export type DashboardStats = {
  todayCount: number
  totalClients: number
  monthRevenue: number
  pending: number
}

export type CreateAppointmentPayload = {
  business_id: string
  client_id: string
  service_ids: string[]
  assigned_user_id: string | null
  start_at: string
  end_at: string
  notes: string | null
  status: string
  is_dual_booking: boolean
}

export interface IAppointmentQueryRepository {
  /**
   * Fetches appointments for a date range (calendar grid).
   */
  getMonthAppointments(
    businessId: string,
    rangeStart: string,
    rangeEnd: string
  ): Promise<Result<AppointmentWithRelations[]>>

  /**
   * Fetches appointments for a single day.
   */
  getDayAppointments(
    businessId: string,
    dateStr: string
  ): Promise<Result<AppointmentWithRelations[]>>

  /**
   * Fetches minimal slot data for conflict/double-booking checks.
   */
  getDaySlots(
    businessId: string,
    startISO: string,
    endISO: string
  ): Promise<Result<SlotCheckAppointment[]>>

  /**
   * Fetches a single appointment for editing.
   */
  getForEdit(
    appointmentId: string,
    businessId: string
  ): Promise<Result<{
    id: string
    client_id: string
    service_id: string | null
    assigned_user_id: string | null
    start_at: string
    status: string
    notes: string | null
    appointment_services: { service_id: string; sort_order: number }[]
  } | null>>

  /**
   * Returns conflicting appointment IDs for a time slot.
   */
  findConflicts(
    businessId: string,
    startAt: string,
    endAt: string,
    excludeId?: string
  ): Promise<Result<{ id: string }[]>>

  /**
   * Returns active upcoming appointments for a client (AI use).
   */
  findUpcomingByClient(
    businessId: string,
    clientId: string
  ): Promise<Result<AiApptRow[]>>

  /**
   * Returns appointments in a date range with optional status filter.
   */
  findByDateRange(
    businessId: string,
    from: string,
    to: string,
    statuses?: string[]
  ): Promise<Result<AppointmentDateRange[]>>

  /**
   * Returns aggregated dashboard stats.
   */
  getDashboardStats(
    businessId: string,
    todayStr: string,
    monthStartStr: string
  ): Promise<Result<DashboardStats>>
}
