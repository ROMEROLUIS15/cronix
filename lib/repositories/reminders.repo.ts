/**
 * Reminders Repository — Supabase queries for appointment_reminders.
 *
 * The `appointment_reminders` table is defined in:
 *   supabase/migrations/20260321_appointment_reminders.sql
 *   types/database.types.ts  (manually synced until next `supabase gen types` run)
 *
 * All mutations accept a standard SupabaseClient (anon or admin).
 * The cron route uses createAdminClient() to bypass RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'

type DbClient = SupabaseClient<Database>

export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

export interface PendingReminderRow {
  id:             string
  appointment_id: string
  business_id:    string
  remind_at:      string
  minutes_before: number
  businesses:   { name: string; settings: Json | null } | null
  appointments: {
    start_at: string
    clients:  { name: string; phone: string | null }
  } | null
}

/**
 * Creates a reminder for an appointment.
 * Silently replaces any existing pending reminder for the same appointment.
 */
export async function upsertReminder(
  supabase: DbClient,
  appointmentId: string,
  businessId:    string,
  remindAt:      string,
  minutesBefore: number
): Promise<void> {
  // Delete existing pending reminder first
  await supabase
    .from('appointment_reminders')
    .delete()
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')

  const { error } = await supabase
    .from('appointment_reminders')
    .insert({
      appointment_id: appointmentId,
      business_id:    businessId,
      remind_at:      remindAt,
      minutes_before: minutesBefore,
      status:         'pending',
      channel:        'whatsapp',
    })

  if (error) throw new Error(`Error creating reminder: ${error.message}`)
}

/**
 * Cancels all pending reminders for an appointment (used when editing).
 */
export async function cancelRemindersByAppointment(
  supabase: DbClient,
  appointmentId: string
): Promise<void> {
  const { error } = await supabase
    .from('appointment_reminders')
    .update({ status: 'cancelled' })
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')

  if (error) throw new Error(`Error cancelling reminders: ${error.message}`)
}

/**
 * Returns due pending reminders with appointment + relation data.
 * Called by the cron route; requires admin client to bypass RLS.
 */
export async function getPendingReminders(
  supabase: DbClient
): Promise<PendingReminderRow[]> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
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

  if (error) throw new Error(`Error fetching pending reminders: ${error.message}`)
  return (data ?? []) as PendingReminderRow[]
}

/**
 * Marks a reminder as sent and stores the sent timestamp.
 */
export async function markReminderSent(
  supabase: DbClient,
  reminderId: string
): Promise<void> {
  const { error } = await supabase
    .from('appointment_reminders')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', reminderId)

  if (error) throw new Error(`Error marking reminder sent: ${error.message}`)
}

/**
 * Marks a reminder as failed and stores the error message.
 */
export async function markReminderFailed(
  supabase: DbClient,
  reminderId: string,
  errorMsg:   string
): Promise<void> {
  const { error } = await supabase
    .from('appointment_reminders')
    .update({ status: 'failed', error_message: errorMsg })
    .eq('id', reminderId)

  if (error) throw new Error(`Error marking reminder failed: ${error.message}`)
}

/**
 * Returns the current pending reminder for an appointment, if any.
 * Used by the edit form to pre-populate the reminder selector.
 */
export async function getAppointmentReminder(
  supabase: DbClient,
  appointmentId: string
): Promise<{ minutes_before: number } | null> {
  const { data } = await supabase
    .from('appointment_reminders')
    .select('minutes_before')
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')
    .maybeSingle()

  return data ?? null
}
