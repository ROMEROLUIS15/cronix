/**
 * IReminderRepository — Domain contract for automated appointment reminders.
 *
 * PendingReminderRow is defined here (not in legacy reminders.repo) to maintain
 * architectural purity: the domain layer owns its own types.
 */

import type { Result } from '@/types/result'

// ── Shared type (was in legacy reminders.repo) ────────────────────────────

export type PendingReminderRow = {
  id: string
  appointment_id: string
  business_id: string
  remind_at: string
  minutes_before: number
  businesses: { name: string; settings: Record<string, unknown> | null } | null
  appointments: {
    start_at: string
    clients: { name: string; phone: string | null } | null
  } | null
}

export interface IReminderRepository {
  /**
   * Creates or updates a pending reminder for an appointment.
   */
  upsert(
    appointmentId: string,
    businessId:    string,
    remindAt:      string,
    minutesBefore: number
  ): Promise<Result<void>>

  /**
   * Cancels all pending reminders for an appointment.
   */
  cancelByAppointment(appointmentId: string): Promise<Result<void>>

  /**
   * Returns current pending reminders for cron processing.
   */
  getPending(): Promise<Result<PendingReminderRow[]>>

  /**
   * Marks a reminder as successfully sent.
   */
  markSent(reminderId: string): Promise<Result<void>>

  /**
   * Marks a reminder as failed with an error message.
   */
  markFailed(reminderId: string, errorMsg: string): Promise<Result<void>>

  /**
   * Gets the current pending reminder configuration for an appointment.
   */
  getForAppointment(appointmentId: string): Promise<Result<{ minutes_before: number } | null>>

  /**
   * Forcefully cancels a reminder and inserts it as cancelled (used for opting out).
   */
  forceCancel(appointmentId: string, businessId: string, remindAt: string, minutesBefore: number): Promise<Result<void>>
}
