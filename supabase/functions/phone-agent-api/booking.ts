/**
 * booking.ts — Books an appointment for the caller (contract §4.4, §5).
 *
 * Through the same booking function as WhatsApp (fn_book_appointment_wa: the client found
 * or created by the caller's number, the overlap checked under the business's lock), after
 * checking the time is one the shared resolver offers: outside the opening hours answers
 * OUTSIDE_HOURS, a taken time SLOT_CONFLICT. The Idempotency-Key is claimed before booking,
 * so a retried request never books twice. Success notifies the owner as WhatsApp does.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAvailableSlots, effectiveWorkingHours, localToUTC, type WorkingHours } from '../_shared/availability.ts'
import { bookedSlotsOnDay } from '../_shared/booked-slots.ts'
import { hmacSha256Hex } from '../_shared/hmac.ts'
import { buildAppointmentEventId } from '../_shared/notifications/event-id.ts'
import type { AppointmentEvent } from '../_shared/notifications/notif-contracts.ts'
import { businessOfCall, fail, type ApiResult, type CallBusiness } from './results.ts'

export interface BookingRequest {
  call_sid:    string
  service_id:  string
  date:        string
  time:        string
  client_name: string
}

/** What a booking returns, and the owner's notification when it booked. */
export interface BookingOutcome {
  status:       number
  result:       ApiResult
  notification: AppointmentEvent | null
}

const ok = (result: ApiResult, notification: AppointmentEvent | null = null): BookingOutcome =>
  ({ status: 200, result, notification })

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

function validRequest(body: Partial<BookingRequest>): body is BookingRequest {
  return typeof body.call_sid === 'string' && !!body.call_sid
    && typeof body.service_id === 'string' && !!body.service_id
    && typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    && typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)
    && typeof body.client_name === 'string' && body.client_name.trim().length > 0 && body.client_name.length <= 120
}

export async function book(
  supabase: SupabaseClient, rawBody: string, body: Partial<BookingRequest>, key: string | null,
): Promise<BookingOutcome> {
  if (!key || key.length > 64) return ok(fail('INVALID_ARGS'))
  if (!validRequest(body)) return ok(fail('INVALID_ARGS'))
  const call = await businessOfCall(supabase, body.call_sid)
  if (!call) return ok(fail('NOT_FOUND'))

  // A digest of the body, not the body: it carries the caller's name.
  const hash = await hmacSha256Hex('phone-agent-request', rawBody)
  const claim = await supabase.from('phone_agent_requests')
    .upsert({ call_sid: body.call_sid, idempotency_key: key, request_hash: hash },
            { onConflict: 'call_sid,idempotency_key', ignoreDuplicates: true })
    .select('request_hash')
  if (claim.error) throw new Error(`phone_agent_requests: ${claim.error.message}`)
  if (!(claim.data ?? []).length) return await replay(supabase, body.call_sid, key, hash)

  const outcome = await bookOnce(supabase, call, body)
  const stored = await supabase.from('phone_agent_requests').update({ response: outcome.result })
    .eq('call_sid', body.call_sid).eq('idempotency_key', key)
  if (stored.error) throw new Error(`phone_agent_requests: ${stored.error.message}`)
  return outcome
}

/** The same key again: the stored response, a mismatch, or a booking still in progress. */
async function replay(supabase: SupabaseClient, callSid: string, key: string, hash: string): Promise<BookingOutcome> {
  const prior = await supabase.from('phone_agent_requests').select('request_hash, response')
    .eq('call_sid', callSid).eq('idempotency_key', key).single()
  if (prior.error) throw new Error(`phone_agent_requests: ${prior.error.message}`)
  const row = prior.data as { request_hash: string; response: ApiResult | null }
  if (row.request_hash !== hash) return { status: 409, result: fail('IDEMPOTENCY_MISMATCH'), notification: null }
  if (!row.response) return { status: 503, result: fail('IN_PROGRESS'), notification: null }
  return ok(row.response)
}

async function bookOnce(supabase: SupabaseClient, call: CallBusiness, req: BookingRequest): Promise<BookingOutcome> {
  const [service, record, business] = await Promise.all([
    supabase.from('services').select('name, duration_min')
      .eq('id', req.service_id).eq('business_id', call.businessId).eq('is_active', true).maybeSingle(),
    supabase.from('phone_agent_calls').select('caller_phone').eq('call_sid', req.call_sid).single(),
    supabase.from('businesses').select('name').eq('id', call.businessId).single(),
  ])
  for (const r of [service, record, business]) {
    if (r.error) throw new Error(`booking: ${r.error.message}`)
  }
  if (!service.data) return ok(fail('INVALID_ARGS'))
  const { name: serviceName, duration_min: duration } = service.data as { name: string; duration_min: number }
  const callerPhone = (record.data as { caller_phone: string | null }).caller_phone
  if (!callerPhone) return ok(fail('INVALID_ARGS'))

  const hours = call.settings.workingHours as WorkingHours
  const booked = await bookedSlotsOnDay(supabase, call.businessId, req.date, call.timezone)
  if (booked.error) throw new Error(`appointments: ${booked.error}`)
  const { slots } = computeAvailableSlots({
    workingHours: hours, date: req.date, timezone: call.timezone, durationMin: duration, bookedSlots: booked.slots,
  })
  if (!slots.includes(req.time)) {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: call.timezone })
      .format(new Date(`${req.date}T12:00:00Z`)).toLowerCase().slice(0, 3)
    const open = effectiveWorkingHours(hours)[day]
    const inside = !!open && minutes(req.time) >= minutes(open[0]) && minutes(req.time) + duration <= minutes(open[1])
    return ok(fail(inside ? 'SLOT_CONFLICT' : 'OUTSIDE_HOURS'))
  }

  const clientName = req.client_name.trim()
  const { data, error } = await supabase.rpc('fn_book_appointment_wa', {
    p_business_id:  call.businessId,
    p_client_phone: callerPhone,
    p_client_name:  clientName,
    p_service_id:   req.service_id,
    p_start_at:     localToUTC(req.date, req.time, call.timezone),
  })
  if (error) throw new Error(`fn_book_appointment_wa: ${error.message}`)
  const result = data as { success: boolean; error?: string; appointment_id?: string }
  if (!result.success) {
    if (result.error === 'SLOT_CONFLICT') return ok(fail('SLOT_CONFLICT'))
    if (result.error === 'SERVICE_NOT_FOUND') return ok(fail('INVALID_ARGS'))
    throw new Error(`fn_book_appointment_wa: ${result.error ?? 'no error code'}`)
  }
  const appointmentId = result.appointment_id!
  return ok({ success: true, appointment_id: appointmentId }, {
    eventId:      buildAppointmentEventId('created', call.businessId, appointmentId, req.date, req.time),
    type:         'appointment.created',
    businessId:   call.businessId,
    businessName: (business.data as { name: string }).name,
    clientName, serviceName,
    date:         req.date,
    time:         req.time,
    userId:       'phone-agent',
    channel:      'phone',
  })
}
