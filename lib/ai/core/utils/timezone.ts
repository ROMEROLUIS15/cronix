/**
 * timezone.ts — Conversión canónica de hora local a UTC.
 *
 * ÚNICA implementación. Antes existía duplicada en:
 *   - lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts (localToUTC)
 *   - supabase/functions/process-whatsapp/time-utils.ts (localTimeToUTC)
 *
 * Algoritmo: usa Intl.DateTimeFormat para calcular el offset real del timezone
 * en la fecha dada, incluyendo DST. No requiere librerías externas.
 *
 * Por qué no usar `new Date(dateStr)`:
 *   "2026-05-03T10:00:00" sin zona → interpretado como UTC por el motor JS.
 *   Un negocio en UTC-5 ve esa cita a las 5am, no a las 10am.
 */

/**
 * Convierte una fecha + hora local expresada en `timezone` a ISO UTC.
 *
 * @param date     YYYY-MM-DD
 * @param time     HH:mm (24h)
 * @param timezone IANA timezone (ej: 'America/Bogota', 'America/Caracas')
 * @returns ISO UTC string (ej: '2026-05-03T15:00:00.000Z')
 */
export function localToUTC(date: string, time: string, timezone: string): string {
  // Tratar la fecha+hora como si fuera UTC (naive epoch)
  const naiveAsUTC = new Date(`${date}T${time}:00Z`)

  // Formatear ese epoch en el timezone objetivo → revela el drift
  const tzStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone:  timezone,
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
    hour:      '2-digit',
    minute:    '2-digit',
    second:    '2-digit',
    hour12:    false,
  }).format(naiveAsUTC)

  // El drift es: naive_epoch - displayed_epoch_interpreted_as_UTC
  const tzAsUTC = new Date(tzStr.replace(' ', 'T') + 'Z')
  const offsetMs = naiveAsUTC.getTime() - tzAsUTC.getTime()

  return new Date(naiveAsUTC.getTime() + offsetMs).toISOString()
}

/**
 * Suma minutos a un ISO UTC string.
 */
export function addMinutesToISO(isoUTC: string, minutes: number): string {
  return new Date(new Date(isoUTC).getTime() + minutes * 60_000).toISOString()
}

/**
 * Normaliza un string de hora a HH:mm 24h.
 * Handles: "5 PM" → "17:00", "3:00 PM" → "15:00", "9am" → "09:00", "15:00" → "15:00"
 *
 * Antes duplicado en:
 *   - decision-engine.ts (extractOwnerTime)
 *   - supabase/functions/process-whatsapp/tool-executor.ts (sanitizeTime)
 */
export function normalizeTime(raw: string): string | null {
  const t = raw.trim()

  // Ya está en formato correcto
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return t

  // Formatos: "5 PM", "5PM", "5:30 PM", "3pm"
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (!m) return null

  let h     = parseInt(m[1]!, 10)
  const min = m[2] ?? '00'
  const p   = m[3]?.toUpperCase()

  if (p === 'PM' && h < 12) h += 12
  if (p === 'AM' && h === 12) h = 0
  if (h > 23 || parseInt(min, 10) > 59) return null

  return `${h.toString().padStart(2, '0')}:${min}`
}

/**
 * Extrae la parte YYYY-MM-DD de un ISO string, en el timezone del negocio.
 * Necesario para mostrar "el lunes 3 de mayo" en la hora correcta del negocio,
 * no en UTC (que puede ser un día diferente).
 */
export function toLocalDateString(isoUTC: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(isoUTC))
}

/**
 * Formatea un ISO UTC a string legible en español para el timezone del negocio.
 */
export function formatLocalDateTime(
  isoUTC: string,
  timezone: string,
  format: 'date' | 'time' | 'datetime' = 'datetime',
): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: timezone }

  if (format === 'date' || format === 'datetime') {
    opts.weekday = 'long'
    opts.day = 'numeric'
    opts.month = 'long'
  }
  if (format === 'time' || format === 'datetime') {
    opts.hour = 'numeric'
    opts.minute = '2-digit'
    opts.hour12 = true
  }

  return new Intl.DateTimeFormat('es-CO', opts).format(new Date(isoUTC))
}
