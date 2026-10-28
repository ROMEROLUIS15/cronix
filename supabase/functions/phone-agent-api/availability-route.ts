/**
 * availability-route.ts — Free starts of one day for one service (contract §4.2), with the
 * resolver every channel uses and the appointments that block a slot for the booking.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAvailableSlots, type WorkingHours } from '../_shared/availability.ts'
import { bookedSlotsOnDay } from '../_shared/booked-slots.ts'
import { businessOfCall, fail, type ApiResult } from './results.ts'

export async function availability(supabase: SupabaseClient, query: URLSearchParams): Promise<ApiResult> {
  const callSid = query.get('call_sid') ?? ''
  const serviceId = query.get('service_id') ?? ''
  const date = query.get('date') ?? ''
  if (!callSid || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('INVALID_ARGS')

  const call = await businessOfCall(supabase, callSid)
  if (!call) return fail('NOT_FOUND')
  const service = await supabase.from('services').select('duration_min')
    .eq('id', serviceId).eq('business_id', call.businessId).eq('is_active', true).maybeSingle()
  if (service.error) throw new Error(`services: ${service.error.message}`)
  if (!service.data) return fail('INVALID_ARGS')

  const booked = await bookedSlotsOnDay(supabase, call.businessId, date, call.timezone)
  if (booked.error) throw new Error(`appointments: ${booked.error}`)
  const { open, slots } = computeAvailableSlots({
    workingHours: call.settings.workingHours as WorkingHours,
    date,
    timezone:     call.timezone,
    durationMin:  (service.data as { duration_min: number }).duration_min,
    bookedSlots:  booked.slots,
  })
  return open ? { success: true, date, slots } : fail('CLOSED_DAY')
}
