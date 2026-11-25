/**
 * wa-tenant-routing.ts — The WhatsApp tenant tiers without #slug, shared by messages
 * (process-whatsapp/business-router.ts) and calls (phone-agent-api/calls.ts):
 *
 *  - session: the business anchored to the sender in `wa_sessions` (by a #slug message, a
 *    client-phone match or a reminder);
 *  - client phone: the business that has the sender registered as a client.
 *
 * Both lookups are cross-business by design and return only the routing decision; every
 * later query stays scoped by business_id. They throw on a database failure, so each caller
 * decides: messages fall to the next tier, a call answers 503.
 *
 * Client-phone decision (agent-proposed, user-accepted 2026-10-05):
 *  - exactly one business has this phone as a client → that business;
 *  - several → the one whose client has the soonest upcoming active appointment;
 *  - otherwise → null. Never guess a tenant.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { waSenderCandidates } from './wa-phone.ts'

export interface ClientPhoneMatch {
  id:          string
  business_id: string
}

export interface UpcomingAppointment {
  business_id: string
  start_at:    string
}

/** Distinct businesses among the matched client rows, in first-seen order. */
export function distinctBusinessIds(matches: ReadonlyArray<ClientPhoneMatch>): string[] {
  return [...new Set(matches.map((m) => m.business_id))]
}

/** Picks the business to route to, or null when it can't be decided safely. */
export function pickBusinessForClientPhone(
  matches:  ReadonlyArray<ClientPhoneMatch>,
  upcoming: ReadonlyArray<UpcomingAppointment>,
): string | null {
  const businesses = distinctBusinessIds(matches)
  if (businesses.length <= 1) return businesses[0] ?? null

  const soonest = upcoming
    .filter((a) => businesses.includes(a.business_id))
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0]
  return soonest?.business_id ?? null
}

/** The business anchored to this sender id (Meta's `from`: digits, no "+"), or null. */
export async function sessionBusinessId(supabase: SupabaseClient, senderId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('wa_sessions')
    .select('business_id')
    .eq('sender_phone', senderId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { business_id: string } | null)?.business_id ?? null
}

/** The business that has this sender (any phone form) as a client, or null when none or undecidable. */
export async function clientPhoneBusinessId(supabase: SupabaseClient, sender: string): Promise<string | null> {
  const candidates = waSenderCandidates(sender)
  if (candidates.length === 0) return null

  const { data, error } = await supabase
    .from('clients')
    .select('id, business_id')
    .in('phone_digits', candidates)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  const matches = (data ?? []) as ClientPhoneMatch[]
  return pickBusinessForClientPhone(matches, await upcomingAppointments(supabase, matches))
}

/** Soonest upcoming active appointment among the matched clients (only needed to break a tie). */
async function upcomingAppointments(
  supabase: SupabaseClient,
  matches:  ReadonlyArray<ClientPhoneMatch>,
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
