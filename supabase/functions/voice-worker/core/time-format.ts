/**
 * Timezone-aware time helpers used by every appointment tool.
 *
 * humanizeDate must anchor to NOON UTC, never midnight, because Edge
 * Functions run in UTC and `new Date(y, m-1, d)` constructs a server-local
 * midnight which lands on the previous day in any negative-UTC zone (e.g.
 * America/Caracas). Anchoring at 12:00Z keeps the calendar day stable from
 * UTC-11 to UTC+12.
 */

export function localToUTC(date: string, time: string, tz: string): string {
  const naiveAsUTC = new Date(`${date}T${time}:00Z`)
  const tzStr      = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(naiveAsUTC)
  const tzDisplayedAsUTC = new Date(tzStr.replace(' ', 'T') + 'Z')
  const offsetMs         = naiveAsUTC.getTime() - tzDisplayedAsUTC.getTime()
  return new Date(naiveAsUTC.getTime() + offsetMs).toISOString()
}

export function buildEndISO(startISO: string, durationMin: number): string {
  return new Date(new Date(startISO).getTime() + durationMin * 60_000).toISOString()
}

export function humanizeDate(isoDate: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: 'numeric', month: 'long', timeZone: timezone,
    }).format(new Date(`${isoDate}T12:00:00Z`))
  } catch {
    return isoDate
  }
}

/**
 * TTS-friendly Spanish time string in the business timezone.
 * Reads naturally aloud; avoids "AM"/"a. m." pronunciation issues.
 */
export function formatTimeFromISO(iso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    }).formatToParts(new Date(iso))
    const hour24 = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const minute =          parts.find(p => p.type === 'minute')?.value ?? '00'

    let displayHour: number
    let suffix: string
    if (hour24 === 0)        { displayHour = 12;          suffix = 'de la madrugada' }
    else if (hour24 < 6)     { displayHour = hour24;      suffix = 'de la madrugada' }
    else if (hour24 < 12)    { displayHour = hour24;      suffix = 'de la mañana' }
    else if (hour24 === 12 && minute === '00') { displayHour = 12; suffix = 'del mediodía' }
    else if (hour24 < 19)    { displayHour = hour24 === 12 ? 12 : hour24 - 12; suffix = 'de la tarde' }
    else                     { displayHour = hour24 - 12; suffix = 'de la noche' }

    return minute === '00'
      ? `${displayHour} ${suffix}`
      : `${displayHour} y ${parseInt(minute, 10)} ${suffix}`
  } catch {
    return iso.slice(11, 16)
  }
}
