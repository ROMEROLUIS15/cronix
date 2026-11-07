import { localToUTC } from '../../_shared/availability.ts'

/** The business's local calendar date (YYYY-MM-DD) at an instant. */
export function localDate(at: Date, timezone: string): string {
  return at.toLocaleDateString('en-CA', { timeZone: timezone })
}

/** The calendar day after a YYYY-MM-DD date. */
export function nextLocalDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Tomorrow in the business timezone, as the UTC instants of its local midnights (a DST
 * night makes it 23 or 25 hours). The 20:00 run reminds the appointments in it.
 */
export function getTomorrowRange(timezone: string, now: Date = new Date()): { start: string; end: string } {
  const tomorrow = nextLocalDate(localDate(now, timezone))
  return {
    start: localToUTC(tomorrow, '00:00', timezone),
    end:   localToUTC(nextLocalDate(tomorrow), '00:00', timezone),
  }
}
