import { createAdminClient } from './db.ts'
import type { AppointmentWithClient } from '../types.ts'

export async function getTomorrowAppointments(
  businessId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<AppointmentWithClient[]> {
  const supabase = createAdminClient()
  const { data: appointments, error: aptErr } = await supabase
    .from('appointments')
    .select(`
      id, start_at, service_id,
      services ( name ),
      clients ( name, phone )
    `)
    .eq('business_id', businessId)
    .gte('start_at', rangeStart)
    .lt('start_at', rangeEnd)
    .not('status', 'in', '("cancelled","no_show")')
    .order('start_at', { ascending: true })

  if (aptErr) throw new Error(aptErr.message)
  return (appointments ?? []) as unknown as AppointmentWithClient[]
}

/**
 * Returns the set of appointment IDs that should be skipped when sending reminders.
 * Skips both:
 *   - 'cancelled'  — user opted out or appointment was cancelled
 *   - 'sent'       — reminder was already delivered in a previous cron run this cycle
 *
 * This makes the cron function idempotent: if pg_cron fires twice within the same
 * hour window, the second run sees the 'sent' records and sends nothing again.
 */
export async function getSkippedReminderIds(
  appointmentIds: string[]
): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set()

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('appointment_reminders')
    .select('appointment_id')
    .in('appointment_id', appointmentIds)
    .in('status', ['cancelled', 'sent'])

  return new Set((data ?? []).map(r => r.appointment_id))
}
