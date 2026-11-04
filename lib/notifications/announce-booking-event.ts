import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

export type BookingAction = 'created' | 'rescheduled' | 'cancelled'

/**
 * announceBookingEvent — tells the shared booking pipeline that an appointment changed: bell,
 * Realtime, push, and WhatsApp to the owner when someone else made the change. The server
 * reads the appointment itself. Never throws: the appointment is already saved.
 */
export async function announceBookingEvent(action: BookingAction, appointmentId: string): Promise<void> {
  try {
    const { error } = await createClient().functions.invoke('booking-event', { body: { action, appointmentId } })
    if (error) logger.error('booking-event', `${action} alert failed`, error)
  } catch (err) {
    logger.error('booking-event', `${action} alert failed`, err)
  }
}
