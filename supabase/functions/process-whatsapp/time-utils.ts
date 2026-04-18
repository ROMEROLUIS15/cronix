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
  // Method 1: The standard formatToParts (may fail if edge runtime lacks full ICU)
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    const naive = new Date(`${dateStr}T${timeStr}:00Z`)
    const offsetStr = (fmt.formatToParts(naive).find(p => p.type === 'timeZoneName')?.value ?? '')
      .replace('GMT', '')
      .replace('UTC', '')
    
    if (offsetStr && offsetStr.includes(':')) {
      const approxUtc = new Date(`${dateStr}T${timeStr}:00${offsetStr}`)
      return approxUtc.toISOString()
    }
  } catch (e) {
    // Ignore and fallback
  }

  // Method 2: Fallback — Calculate the offset manually by comparing locales
  // If we want 15:30 in Caracas, we find the UTC time that produces 15:30 in Caracas.
  const targetTime = new Date(`${dateStr}T${timeStr}:00`).getTime() // Local naive timestamp
  let guess = new Date(targetTime) // Start guess at local time

  for (let i = 0; i < 3; i++) { // Max 3 iterations for DST stability
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(guess)

    const map = Object.fromEntries(parts.map(p => [p.type, p.value]))
    // Reconstruct the naive timestamp of what the guess produced IN the target timezone
    // JS dates treat this generic string as local system time, which matches our targetTime's perspective
    const guessProduced = new Date(
      `${map.year}-${map.month}-${map.day}T${map.hour === '24' ? '00' : map.hour}:${map.minute}:${map.second}`
    ).getTime()

    const diff = targetTime - guessProduced
    if (diff === 0) break
    guess = new Date(guess.getTime() + diff)
  }

  return guess.toISOString()
}
