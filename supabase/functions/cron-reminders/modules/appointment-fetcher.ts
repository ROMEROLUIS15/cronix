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

export async function getCancelledReminders(
  appointmentIds: string[]
): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set()

  const supabase = createAdminClient()
  const { data: cancelledReminders } = await supabase
    .from('appointment_reminders')
    .select('appointment_id')
    .in('appointment_id', appointmentIds)
    .eq('status', 'cancelled')

  return new Set((cancelledReminders ?? []).map(r => r.appointment_id))
}
