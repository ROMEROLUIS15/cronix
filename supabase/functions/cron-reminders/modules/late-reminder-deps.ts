import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getSkippedReminderIds } from './reminder-status.ts'
import { sendWhatsAppReminders } from './whatsapp-sender.ts'
import type { AppointmentWithStatus, LateReminderDeps } from './late-reminder.ts'
import type { BusinessRow } from '../types.ts'

/** The production wiring: every read is scoped to the business. */
export function supabaseLateReminderDeps(db: SupabaseClient, cronSecret: string): LateReminderDeps {
  return {
    async loadBusiness(businessId) {
      const { data, error } = await db
        .from('businesses').select('id, name, timezone, phone, settings').eq('id', businessId).maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as BusinessRow | null
    },
    async loadAppointment(businessId, appointmentId) {
      const { data, error } = await db
        .from('appointments')
        .select('id, start_at, service_id, status, services ( name ), clients ( name, phone )')
        .eq('business_id', businessId)
        .eq('id', appointmentId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as unknown as AppointmentWithStatus | null
    },
    skippedIds: (businessId, appointmentId, options) =>
      getSkippedReminderIds(db, businessId, [appointmentId], new Date(), options),
    send: (business, appointment, skipped) => sendWhatsAppReminders(business, [appointment], skipped, cronSecret),
  }
}
