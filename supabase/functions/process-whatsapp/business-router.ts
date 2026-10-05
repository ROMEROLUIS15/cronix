/**
 * Business Router — slug resolution, session anchoring, phone verification.
 *
 * Single-number architecture: one WhatsApp number serves multiple businesses.
 * Routing priority (orchestrated by tenant-routing.ts):
 *  1. Explicit #slug in the message → resolve by slug
 *  2. No slug → check wa_sessions for the last active business
 *  3. No session → the business that has this sender registered as a client
 *  4. None → caller sends SaaS landing message
 */

import type { BusinessRow } from "./types.ts"
import { supabase }         from "./db-client.ts"
import { captureException } from "../_shared/sentry.ts"
import { waSenderCandidates } from "../_shared/wa-phone.ts"
import { logInteraction }   from "./audit.ts"
import {
  type ClientPhoneMatch, type UpcomingAppointment,
  distinctBusinessIds, pickBusinessForClientPhone,
} from "./client-phone-routing.ts"

const BUSINESS_COLUMNS = 'id, name, phone, address, timezone, settings, slug'

async function getBusinessById(businessId: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select(BUSINESS_COLUMNS)
    .eq('id', businessId)
    .single()

  if (error || !data) return null
  return data as BusinessRow
}

export async function getBusinessBySlug(slug: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select(BUSINESS_COLUMNS)
    .eq('slug', slug)
    .single()

  if (error || !data) return null
  return data as BusinessRow
}

/**
 * Retrieves the last business a sender interacted with from wa_sessions.
 * Fallback when no #slug is present in the message.
 */
export async function getSessionBusiness(senderPhone: string): Promise<BusinessRow | null> {
  const { data: session, error: sessionErr } = await supabase
    .from('wa_sessions')
    .select('business_id')
    .eq('sender_phone', senderPhone)
    .single()

  if (sessionErr || !session) return null
  return getBusinessById((session as { business_id: string }).business_id)
}

/**
 * Tier 3: resolves a sender with no slug and no session by the clients registered with
 * that phone (e.g. a client added from the dashboard replying to a reminder). Tenant
 * resolution is inherently cross-business — same as the wa_sessions lookup — and returns
 * only the routing decision; every downstream query stays scoped by business_id.
 */
export async function getBusinessByClientPhone(senderPhone: string): Promise<BusinessRow | null> {
  const candidates = waSenderCandidates(senderPhone)
  if (candidates.length === 0) return null

  const { data, error } = await supabase
    .from('clients')
    .select('id, business_id')
    .in('phone_digits', candidates)
    .is('deleted_at', null)

  if (error) {
    captureException(new Error(error.message), { stage: 'route_by_client_phone' })
    return null
  }
  const matches  = (data ?? []) as ClientPhoneMatch[]
  const upcoming = await getUpcomingAppointments(matches)
  const businessId = pickBusinessForClientPhone(matches, upcoming)
  return businessId ? getBusinessById(businessId) : null
}

/** Soonest upcoming active appointment among the matched clients (only needed to break a tie). */
async function getUpcomingAppointments(
  matches: ReadonlyArray<ClientPhoneMatch>,
): Promise<UpcomingAppointment[]> {
  const businessIds = distinctBusinessIds(matches)
  if (businessIds.length < 2) return []

  const { data, error } = await supabase
    .from('appointments')
    .select('business_id, start_at')
    .in('business_id', businessIds)
    .in('client_id', matches.map((m) => m.id))
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(1)

  if (error || !data) return []
  return data as UpcomingAppointment[]
}

/**
 * Anchors a sender to a business in wa_sessions.
 * Called when a #slug or the client phone (tier 3) resolves, so future messages without slug
 * automatically route to the same business.
 */
export async function upsertSession(senderPhone: string, businessId: string): Promise<void> {
  await supabase
    .from('wa_sessions')
    .upsert(
      { sender_phone: senderPhone, business_id: businessId, updated_at: new Date().toISOString() },
      { onConflict: 'sender_phone' }
    )
}

/**
 * Legacy: resolves business by WhatsApp phone number ID or display phone.
 * Only useful if a business has a dedicated WhatsApp number.
 */
export async function getBusinessByPhone(waIdentifier: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .rpc('fn_get_business_by_phone', { p_wa_phone_id: waIdentifier })

  if (error || !data || (data as BusinessRow[]).length === 0) return null
  return (data as BusinessRow[])[0]
}

/**
 * Verifies (or updates) the business phone number and sets wa_verified = true.
 * Returns business name on success, 'ALREADY_VERIFIED' if unchanged, null on failure.
 */
export async function verifyBusinessPhone(
  slug:  string,
  phone: string
): Promise<string | 'ALREADY_VERIFIED' | null> {
  const business = await getBusinessBySlug(slug)
  if (!business) return null

  const settings = (business.settings ?? {}) as Record<string, unknown>
  if (settings.wa_verified === true && business.phone === phone) {
    return 'ALREADY_VERIFIED'
  }

  const { data, error } = await supabase
    .from('businesses')
    .update({ phone, settings: { ...settings, wa_verified: true } })
    .eq('slug', slug)
    .select('name')
    .single()

  if (error || !data) {
    captureException(error ?? new Error('Unknown error updating phone'), { stage: 'db_verify_phone', slug })
    return null
  }

  await logInteraction({
    business_id:  business.id,
    sender_phone: phone,
    message_text: `[SYSTEM] VINCULAR-${slug}`,
    ai_response:  `Business verified/updated: ${data.name}`,
  })

  return data.name
}
