/**
 * Retention opt-out — inbound STOP detection (modulo-retencion §8).
 *
 * Deterministic keyword match (NO LLM in the critical path). Marks the client
 * permanently excluded from re-engagement and invalidates the dashboard cache.
 * Scoped by business_id; matched by phone_digits (the WhatsApp sender id).
 *
 * The DB deps are imported lazily inside markRetentionOptOut so this module's
 * top level stays side-effect free — keeping isOptOutRequest unit-testable
 * outside the Deno runtime (db-client.ts reads Deno.env at import time).
 */

/**
 * True when the message is a request to stop receiving re-engagement messages.
 * Deliberately narrow so it never collides with appointment cancellation
 * ("cancelar cita") — every pattern is about messages/contact, not bookings.
 */
export function isOptOutRequest(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

  // Standalone STOP / BAJA / UNSUBSCRIBE (whole message).
  if (/^(stop|baja|unsubscribe)\.?$/.test(t)) return true

  const patterns: RegExp[] = [
    /no me (escrib|mand|envi)\w*/,            // no me escriban / manden / envíen
    /dej(en|a|ar) de (escribir|enviar|mandar|molestar|contactar)/,
    /no (quiero|deseo)\b.*\bmensaj/,          // (ya) no quiero más mensajes
    /no\s*(mas|más)\s*mensaj/,                // no más mensajes
    /dar(me)? de baja/,                       // dar(me) de baja
    /cancelar\s+(la\s+)?suscrip/,             // cancelar suscripción
    /no\s+(me\s+)?contact/,                   // no me contacten
  ]

  return patterns.some((re) => re.test(t))
}

/**
 * Marks every client of the business with this phone as opted out. Idempotent;
 * a non-matching phone updates zero rows (still a success — intent honored).
 */
export async function markRetentionOptOut(
  businessId:   string,
  senderDigits: string,
): Promise<void> {
  const { supabase }                 = await import("./db-client.ts")
  const { invalidateDashboardCache } = await import("../_shared/cache-invalidation.ts")

  const { error } = await supabase
    .from('clients')
    .update({ retention_opted_out: true })
    .eq('business_id', businessId)
    .eq('phone_digits', senderDigits)

  if (error) throw new Error(`markRetentionOptOut: ${error.message}`)

  void invalidateDashboardCache(businessId)
}
