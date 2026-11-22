/**
 * retention-days.ts — validates the number of days the owner types for win-back.
 * Pure: no I/O.
 *
 * The number is how many days a client has gone without a visit before the
 * win-back message goes out, and also how long to wait before writing again to a
 * client who still has not come back. There is no default: the owner chooses it.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §3.
 */

export const RETENTION_DAYS_MIN = 1
export const RETENTION_DAYS_MAX = 365

/** A whole number of days within range, or null when the input is not one. */
export function parseRetentionDays(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const days = Number(text)
  return days >= RETENTION_DAYS_MIN && days <= RETENTION_DAYS_MAX ? days : null
}
