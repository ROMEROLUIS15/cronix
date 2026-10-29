/**
 * calls.ts — The start and the end of a phone call (contract §4.1, §4.7).
 *
 * The start resolves the business from the dialed number (phone_agent_lines) and keeps the
 * call record every later request reads its business from. The phone line never verifies
 * the caller (caller ID can be spoofed), so no client is named back to it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveWorkingHours, type WorkingHours } from '../_shared/availability.ts'
import { fail, type ApiResult } from './results.ts'

/** Mirrors lib/constants/business.ts DEFAULT_PRICE_CURRENCY (Next.js code is not importable here). */
const DEFAULT_PRICE_CURRENCY = 'USD'

const OUTCOMES = ['booked', 'rescheduled', 'cancelled', 'message_taken', 'info_only', 'abandoned']

export interface CallStart {
  call_sid: string
  channel:  string
  to:       string
  from:     string | null
}

export function digitsOf(phone: string): string {
  return phone.replace(/\D/g, '')
}

export async function startCall(supabase: SupabaseClient, body: Partial<CallStart>): Promise<ApiResult> {
  const { call_sid, channel, to, from } = body
  if (typeof call_sid !== 'string' || !call_sid || call_sid.length > 64 || channel !== 'twilio' || typeof to !== 'string') {
    return fail('INVALID_ARGS')
  }
  const line = await supabase.from('phone_agent_lines').select('business_id').eq('phone_digits', digitsOf(to)).maybeSingle()
  if (line.error) throw new Error(`phone_agent_lines: ${line.error.message}`)
  if (!line.data) return fail('UNKNOWN_LINE')
  const businessId = (line.data as { business_id: string }).business_id

  const [business, services, record] = await Promise.all([
    supabase.from('businesses').select('name, timezone, settings').eq('id', businessId).single(),
    supabase.from('services').select('id, name, duration_min, price')
      .eq('business_id', businessId).eq('is_active', true).order('name'),
    supabase.from('phone_agent_calls').upsert(
      { call_sid, business_id: businessId, channel, caller_phone: typeof from === 'string' ? from : null },
      { onConflict: 'call_sid', ignoreDuplicates: true },
    ),
  ])
  for (const r of [business, services, record]) {
    if (r.error) throw new Error(`call start: ${r.error.message}`)
  }
  const biz = business.data as { name: string; timezone: string | null; settings: Record<string, unknown> | null }
  const settings = biz.settings ?? {}
  return {
    success: true,
    business: {
      // For the agent's call trace only: no endpoint accepts it back (the business comes
      // from the call record).
      id:       businessId,
      name:     biz.name,
      timezone: biz.timezone ?? 'UTC',
      currency: typeof settings.currency === 'string' ? settings.currency : DEFAULT_PRICE_CURRENCY,
    },
    services:      services.data ?? [],
    working_hours: effectiveWorkingHours(settings.workingHours as WorkingHours),
    known_client:  null,
  }
}

export async function endCall(supabase: SupabaseClient, callSid: string, body: { outcome?: unknown }): Promise<ApiResult> {
  if (typeof body.outcome !== 'string' || !OUTCOMES.includes(body.outcome)) return fail('INVALID_ARGS')
  const { data, error } = await supabase.from('phone_agent_calls')
    .update({ outcome: body.outcome, ended_at: new Date().toISOString() })
    .eq('call_sid', callSid).select('call_sid')
  if (error) throw new Error(`call end: ${error.message}`)
  return (data ?? []).length ? { success: true } : fail('NOT_FOUND')
}
