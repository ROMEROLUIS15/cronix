/**
 * SupabaseReminderRepository — Concrete implementation of IReminderRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail } from '@/types/result'
import { IReminderRepository, PendingReminderRow } from '@/lib/domain/repositories/IReminderRepository'

type Client = SupabaseClient<Database>

export class SupabaseReminderRepository implements IReminderRepository {
  constructor(private supabase: Client) {}

  async upsert(
    appointmentId: string,
    businessId:    string,
    remindAt:      string,
    minutesBefore: number
  ): Promise<Result<void>> {
    // Atomic RPC: DELETE + INSERT in a single PostgreSQL transaction,
    // eliminating the crash-vulnerable window between two HTTP round-trips.
    const { error } = await (this.supabase.rpc as any)('fn_upsert_reminder', {
      p_appointment_id: appointmentId,
      p_business_id:    businessId,
      p_remind_at:      remindAt,
      p_minutes_before: minutesBefore,
    })

    if (error) return fail(`Error upserting reminder: ${error.message}`)
    return ok(undefined)
  }

  async cancelByAppointment(appointmentId: string): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('appointment_reminders')
      .update({ status: 'cancelled' })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending')

    if (error) return fail(`Error cancelling reminders: ${error.message}`)
    return ok(undefined)
  }

  async getPending(): Promise<Result<PendingReminderRow[]>> {
    const now = new Date().toISOString()

    const { data, error } = await this.supabase
      .from('appointment_reminders')
      .select(`
        id,
        appointment_id,
        business_id,
        remind_at,
        minutes_before,
        businesses ( name, settings ),
        appointments (
          start_at,
          clients ( name, phone )
        )
      `)
      .eq('status', 'pending')
      .lte('remind_at', now)
      .limit(100)

    if (error) return fail(`Error fetching pending reminders: ${error.message}`)
    // The nested join shape matches PendingReminderRow — safe to cast
    return ok((data ?? []) as PendingReminderRow[])
  }

  async markSent(reminderId: string): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('appointment_reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', reminderId)

    if (error) return fail(`Error marking reminder sent: ${error.message}`)
    return ok(undefined)
  }

  async markFailed(reminderId: string, errorMsg: string): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('appointment_reminders')
      .update({ status: 'failed', error_message: errorMsg })
      .eq('id', reminderId)

    if (error) return fail(`Error marking reminder failed: ${error.message}`)
    return ok(undefined)
  }

  async getForAppointment(appointmentId: string): Promise<Result<{ minutes_before: number } | null>> {
    const { data, error } = await this.supabase
      .from('appointment_reminders')
      .select('minutes_before')
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending')
      .maybeSingle()

    if (error) return fail(`Error fetching appointment reminder: ${error.message}`)
    return ok(data ?? null)
  }

  async forceCancel(
    appointmentId: string,
    businessId: string,
    remindAt: string,
    minutesBefore: number
  ): Promise<Result<void>> {
     const { error } = await this.supabase
      .from('appointment_reminders')
      .insert({
        appointment_id: appointmentId,
        business_id:    businessId,
        remind_at:      remindAt,
        minutes_before: minutesBefore,
        status:         'cancelled',
        channel:        'whatsapp',
      })

    if (error) return fail(`Error force-cancelling reminder: ${error.message}`)
    return ok(undefined)
  }
}
