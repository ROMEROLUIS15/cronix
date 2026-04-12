/**
 * Time utilities — DST-aware UTC conversion.
 */

/**
 * Converts a local date + time string to a UTC ISO timestamp.
 *
 * Two-step DST-aware approach:
 *  1. Get the approximate offset by treating local time as UTC (wrong by offset amount).
 *  2. Apply that offset, then re-check the offset at the resulting UTC time.
 *     If DST caused the offset to change (e.g. spring-forward transition), recalculate.
 *
 * Correctly handles all IANA timezones including DST-aware ones
 * (Mexico, Spain, US Eastern, etc.) and fixed-offset zones (Colombia, Venezuela, etc.).
 */
export function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })

  // Step 1: Anchor to get approximate offset (naive — treats local time as UTC)
  const naive      = new Date(`${dateStr}T${timeStr}:00Z`)
  const offsetStr  = (fmt.formatToParts(naive).find(p => p.type === 'timeZoneName')?.value ?? 'GMT')
    .replace('GMT', '')

  if (!offsetStr) return `${dateStr}T${timeStr}:00Z`

  // Step 2: Apply offset to get approximate UTC
  const approxUtc = new Date(`${dateStr}T${timeStr}:00${offsetStr}`)

  // Step 3: Re-check offset at the approximate UTC (DST correction)
  const verifiedOffsetStr = (fmt.formatToParts(approxUtc).find(p => p.type === 'timeZoneName')?.value ?? 'GMT')
    .replace('GMT', '')

  // Step 4: If offset changed across the DST boundary, recalculate with the real offset
  if (verifiedOffsetStr && verifiedOffsetStr !== offsetStr) {
    return new Date(`${dateStr}T${timeStr}:00${verifiedOffsetStr}`).toISOString()
  }

  return approxUtc.toISOString()
}
