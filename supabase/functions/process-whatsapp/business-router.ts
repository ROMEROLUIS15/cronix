/**
 * Business Router — slug resolution, session anchoring, phone verification.
 *
 * Single-number architecture: one WhatsApp number serves multiple businesses.
 * Routing priority:
 *  1. Explicit #slug in the message → resolve by slug
 *  2. No slug → check wa_sessions for the last active business
 *  3. Neither → caller sends SaaS landing message
 */

import type { BusinessRow } from "./types.ts"
import { supabase }         from "./db-client.ts"
import { captureException } from "../_shared/sentry.ts"
import { logInteraction }   from "./audit.ts"

export async function getBusinessBySlug(slug: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, phone, timezone, settings, slug')
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

  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, phone, timezone, settings, slug')
    .eq('id', (session as { business_id: string }).business_id)
    .single()

  if (error || !data) return null
  return data as BusinessRow
}

/**
 * Anchors a sender to a business in wa_sessions.
 * Called when a #slug resolves successfully so future messages without slug
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
