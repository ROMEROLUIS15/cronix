/**
 * retention-order.ts — the order businesses draw from the shared daily win-back
 * budget. Pure: no I/O.
 *
 * Businesses are sorted by id and the starting point moves one place each UTC
 * day, so when the platform budget does not reach every business, the ones left
 * out change from day to day instead of always being the same.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §2 (topes diarios).
 */

const DAY_MS = 24 * 60 * 60 * 1000

export function orderBusinessesForDay(businessIds: readonly string[], now: Date): string[] {
  const sorted = [...businessIds].sort()
  if (sorted.length === 0) return sorted
  const day = Math.floor(now.getTime() / DAY_MS)
  const start = day % sorted.length
  return [...sorted.slice(start), ...sorted.slice(0, start)]
}
