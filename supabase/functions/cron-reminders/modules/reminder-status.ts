import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Each business is reminded once a day, at its 20:00. A WhatsApp reminder sent less
 * than this long ago belongs to tonight's run; an older one was for a previous date
 * (nothing deletes the 'sent' row when the appointment is rescheduled).
 */
const SAME_RUN_WINDOW_MS = 12 * 60 * 60 * 1000

type ReminderRow = { appointment_id: string; status: string; channel: string; sent_at: string | null }

/**
 * Appointments that must not get a reminder tonight: the reminder was cancelled, or a
 * WhatsApp reminder already went out in this run (pg_cron fired twice in the hour).
 * Throws on a database error; the caller decides whether to send anyway.
 */
export async function getSkippedReminderIds(
  db: SupabaseClient,
  businessId: string,
  appointmentIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set()

  const { data, error } = await db
    .from('appointment_reminders')
    .select('appointment_id, status, channel, sent_at')
    .eq('business_id', businessId)
    .in('appointment_id', appointmentIds)
    .in('status', ['cancelled', 'sent'])
  if (error) throw new Error(error.message)

  const runStart = now.getTime() - SAME_RUN_WINDOW_MS
  const sentTonight = (r: ReminderRow) =>
    r.status === 'sent' && r.channel === 'whatsapp' && !!r.sent_at && new Date(r.sent_at).getTime() >= runStart

  return new Set(
    ((data ?? []) as ReminderRow[])
      .filter((r) => r.status === 'cancelled' || sentTonight(r))
      .map((r) => r.appointment_id),
  )
}

/**
 * Records whether the WhatsApp reminder reached the client, on the row the dashboard
 * scheduled for the appointment, or on a new one when there is none. Updates first:
 * `appointment_id` has no full unique index, so an upsert on it is rejected.
 */
export async function recordReminderOutcome(
  db: SupabaseClient,
  outcome: { appointmentId: string; businessId: string; delivered: boolean; now: string },
): Promise<{ success: boolean; error?: string }> {
  const { appointmentId, businessId, delivered, now } = outcome
  const fields = {
    status: delivered ? 'sent' : 'failed',
    sent_at: delivered ? now : null,
    error_message: delivered ? null : 'WhatsApp delivery failed',
  }

  const { data: updated, error: updateError } = await db
    .from('appointment_reminders')
    .update(fields)
    .eq('business_id', businessId)
    .eq('appointment_id', appointmentId)
    .eq('channel', 'whatsapp')
    .neq('status', 'cancelled')
    .select('id')
  if (updateError) return { success: false, error: updateError.message }
  if (updated && updated.length > 0) return { success: true }

  const { error: insertError } = await db.from('appointment_reminders').insert({
    appointment_id: appointmentId,
    business_id: businessId,
    remind_at: now,
    channel: 'whatsapp',
    ...fields,
  })
  if (insertError) return { success: false, error: insertError.message }
  return { success: true }
}
