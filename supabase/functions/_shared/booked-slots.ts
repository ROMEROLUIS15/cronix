/**
 * booked-slots.ts — The appointments that block slots on one local day of a business.
 *
 * Every status except 'cancelled' and 'no_show' blocks, the rule fn_book_appointment_wa
 * applies. The day is bounded in the business's time zone (start_at is stored in UTC):
 * naive date strings would query a UTC day offset from the business's local day.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { localToUTC, type BookedSlot } from './availability.ts'

export const BLOCKING_STATUSES = ['pending', 'confirmed', 'completed'] as const

export async function bookedSlotsOnDay(
  supabase:   SupabaseClient,
  businessId: string,
  date:       string,
  timezone:   string,
): Promise<{ slots: BookedSlot[]; error: string | null }> {
  const { data, error } = await supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', businessId)
    .in('status', [...BLOCKING_STATUSES])
    .gte('start_at', localToUTC(date, '00:00', timezone))
    .lte('start_at', localToUTC(date, '23:59', timezone))
    .order('start_at')
  if (error) return { slots: [], error: error.message }
  return { slots: (data ?? []) as BookedSlot[], error: null }
}
