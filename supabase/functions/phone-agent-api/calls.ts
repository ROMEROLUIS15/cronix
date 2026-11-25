/**
 * calls.ts — The start and the end of a call (contract §4.1, §4.7), and the context a call
 * gets once its business is known.
 *
 * The start keeps the call record every later request reads its business from:
 *  - phone line (`twilio`): the business owns the dialed number (phone_agent_lines). The
 *    caller ID can be spoofed, so the identity is never verified and no client is named.
 *  - WhatsApp: Meta verifies the caller, and the business comes from the same routing as a
 *    message without #slug (_shared/wa-tenant-routing.ts: session, then client phone). When
 *    it cannot decide, the call is recorded without a business and the caller names it
 *    (business-choice.ts, §4.1b).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveWorkingHours, type WorkingHours } from '../_shared/availability.ts'
import { toWaSenderId, waSenderCandidates } from '../_shared/wa-phone.ts'
import { clientPhoneBusinessId, sessionBusinessId } from '../_shared/wa-tenant-routing.ts'
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

interface OfferedService {
  id:           string
  name:         string
  /** The name an English call says; null when the business entered none. */
  name_en:      string | null
  duration_min: number
  price:        number
}

/** A blank or missing English name is no English name: the agent falls back to `name`. */
function offeredServices(rows: unknown): OfferedService[] {
  return ((rows ?? []) as Array<Omit<OfferedService, 'name_en'> & { name_en?: string | null }>).map((s) => ({
    id:           s.id,
    name:         s.name,
    name_en:      s.name_en?.trim() || null,
    duration_min: s.duration_min,
    price:        s.price,
  }))
}

export function digitsOf(phone: string): string {
  return phone.replace(/\D/g, '')
}

export async function startCall(supabase: SupabaseClient, body: Partial<CallStart>): Promise<ApiResult> {
  const { call_sid, channel } = body
  if (typeof call_sid !== 'string' || !call_sid || call_sid.length > 64) return fail('INVALID_ARGS')
  if (channel === 'twilio') return await startPhoneLineCall(supabase, call_sid, body)
  if (channel === 'whatsapp') return await startWhatsAppCall(supabase, call_sid, body)
  return fail('INVALID_ARGS')
}

async function startPhoneLineCall(supabase: SupabaseClient, callSid: string, body: Partial<CallStart>): Promise<ApiResult> {
  const { to, from } = body
  if (typeof to !== 'string') return fail('INVALID_ARGS')
  const line = await supabase.from('phone_agent_lines').select('business_id').eq('phone_digits', digitsOf(to)).maybeSingle()
  if (line.error) throw new Error(`phone_agent_lines: ${line.error.message}`)
  if (!line.data) return fail('UNKNOWN_LINE')
  const businessId = (line.data as { business_id: string }).business_id
  const [context] = await Promise.all([
    callContext(supabase, businessId, null),
    recordCall(supabase, callSid, businessId, 'twilio', typeof from === 'string' ? from : null),
  ])
  return context
}

async function startWhatsAppCall(supabase: SupabaseClient, callSid: string, body: Partial<CallStart>): Promise<ApiResult> {
  const { from } = body
  const senderId = typeof from === 'string' ? toWaSenderId(from) : null
  if (!senderId || typeof from !== 'string') return fail('INVALID_ARGS')
  const businessId = await sessionBusinessId(supabase, senderId) ?? await clientPhoneBusinessId(supabase, from)
  const record = recordCall(supabase, callSid, businessId, 'whatsapp', from)
  if (!businessId) {
    await record
    return { success: true, business: null, needs_business_choice: true }
  }
  const [context] = await Promise.all([callContext(supabase, businessId, from), record])
  return context
}

/** The call record, kept once per call; only a WhatsApp caller's identity is verified (§4.1). */
async function recordCall(
  supabase: SupabaseClient, callSid: string, businessId: string | null, channel: 'twilio' | 'whatsapp', callerPhone: string | null,
): Promise<void> {
  const { error } = await supabase.from('phone_agent_calls').upsert(
    { call_sid: callSid, business_id: businessId, channel, caller_phone: callerPhone, identity_verified: channel === 'whatsapp' },
    { onConflict: 'call_sid', ignoreDuplicates: true },
  )
  if (error) throw new Error(`call record: ${error.message}`)
}

/**
 * What the agent needs about the call's business (§4.1): its name, time zone, currency,
 * active services and the hours that apply. `verifiedCaller` is the caller's number only
 * when Meta verified it (WhatsApp): then the client of this business with that number is
 * named back, by first name only.
 */
export async function callContext(
  supabase: SupabaseClient, businessId: string, verifiedCaller: string | null,
): Promise<ApiResult> {
  const [business, services, knownClient] = await Promise.all([
    supabase.from('businesses').select('name, timezone, settings').eq('id', businessId).single(),
    supabase.from('services').select('id, name, name_en, duration_min, price')
      .eq('business_id', businessId).eq('is_active', true).order('name'),
    verifiedCaller ? knownClientFirstName(supabase, businessId, verifiedCaller) : Promise.resolve(null),
  ])
  for (const r of [business, services]) {
    if (r.error) throw new Error(`call context: ${r.error.message}`)
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
    services:      offeredServices(services.data),
    working_hours: effectiveWorkingHours(settings.workingHours as WorkingHours),
    known_client:  knownClient,
  }
}

/** First name of this business's client with the caller's number (any stored form), or null. */
async function knownClientFirstName(supabase: SupabaseClient, businessId: string, phone: string): Promise<string | null> {
  const candidates = waSenderCandidates(phone)
  if (candidates.length === 0) return null
  const { data, error } = await supabase.from('clients').select('name')
    .eq('business_id', businessId).in('phone_digits', candidates).is('deleted_at', null)
    .limit(1).maybeSingle()
  if (error) throw new Error(`clients: ${error.message}`)
  const name = (data as { name: string | null } | null)?.name?.trim()
  return name ? (name.split(/\s+/)[0] ?? null) : null
}

export async function endCall(supabase: SupabaseClient, callSid: string, body: { outcome?: unknown }): Promise<ApiResult> {
  if (typeof body.outcome !== 'string' || !OUTCOMES.includes(body.outcome)) return fail('INVALID_ARGS')
  const { data, error } = await supabase.from('phone_agent_calls')
    .update({ outcome: body.outcome, ended_at: new Date().toISOString() })
    .eq('call_sid', callSid).select('call_sid')
  if (error) throw new Error(`call end: ${error.message}`)
  return (data ?? []).length ? { success: true } : fail('NOT_FOUND')
}
