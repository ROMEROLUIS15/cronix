/**
 * wa-phone.ts — WhatsApp sender-id normalization (pure, runtime-agnostic).
 *
 * Meta identifies a WhatsApp user by `from`: international digits, no "+", no trunk
 * zero (e.g. "584121234567"). Our stored `clients.phone` is free-form, so its
 * `phone_digits` can carry a national trunk zero right after the country code
 * ("+58 0412…" → "5804121234567"). These helpers bridge both shapes so a stored
 * phone and a Meta sender resolve to the same id — used to anchor `wa_sessions`
 * when a reminder is sent and to route a reply by the client's phone.
 *
 * Heuristic shared with `fn_find_client_by_phone` (2-digit country code + trunk 0),
 * tightened to 9–10 trailing digits so it never rewrites an 11-digit NANP number
 * (+1 202… → "12025551234" keeps its 0).
 */

/** Trunk zero right after a 2-digit country code, with 9–10 national digits after it. */
const TRUNK_ZERO_RE = /^(\d{2})0(\d{9,10})$/

/** Canonical WhatsApp sender id for a stored phone, or null when it has no digits. */
export function toWaSenderId(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  return digits.replace(TRUNK_ZERO_RE, '$1$2')
}

/**
 * The `phone_digits` forms a stored client phone may take for this Meta sender:
 * the sender itself, plus the trunk-zero variant when re-inserting it is plausible.
 * Every candidate canonicalizes back to the same sender id.
 */
export function waSenderCandidates(sender: string): string[] {
  const id = toWaSenderId(sender)
  if (!id) return []
  const withTrunk = `${id.slice(0, 2)}0${id.slice(2)}`
  return TRUNK_ZERO_RE.test(withTrunk) ? [id, withTrunk] : [id]
}
