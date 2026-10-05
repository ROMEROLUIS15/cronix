/**
 * client-phone-routing.ts — Tier-3 tenant decision (pure): which business owns a sender
 * that has no #slug and no session, judged by the clients registered with that phone.
 *
 * Decision (agent-proposed, user-accepted 2026-10-05):
 *  - exactly one business has this phone as a client → that business;
 *  - several → the one whose client has the soonest upcoming active appointment
 *    (the reply most likely refers to it);
 *  - otherwise → null: the caller sends the landing. Never guess a tenant.
 */

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
