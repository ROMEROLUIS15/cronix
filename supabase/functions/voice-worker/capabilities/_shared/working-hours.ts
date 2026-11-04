import type { ToolContext } from '../../core/tool-context.ts'
import { formatTimeFromISO, humanizeDate, localToUTC } from '../../core/time-format.ts'
import { outsideWorkingHours, type WorkingHours } from '../../../_shared/availability.ts'

// The voice context names days in full ({ monday: { open, close } }); the shared resolver reads
// the dashboard's stored shape ({ mon: [open, close] }).
const STORED_DAY_KEY: Record<string, string> = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
}

export function storedWorkingHours(hours: ToolContext['workingHours']): WorkingHours {
  if (!hours) return undefined
  return Object.fromEntries(
    Object.entries(hours).map(([day, h]) => [STORED_DAY_KEY[day] ?? day, h ? [h.open, h.close] : null]),
  ) as WorkingHours
}

/** What to tell the user when this time is outside the business hours; null when it fits. */
export function hoursRefusal(ctx: ToolContext, date: string, time: string, durationMin: number): string | null {
  const outside = outsideWorkingHours({
    workingHours: storedWorkingHours(ctx.workingHours), date, time, durationMin, timezone: ctx.timezone,
  })
  if (!outside) return null
  if (outside.closed) return `El negocio está cerrado el ${humanizeDate(date, ctx.timezone)}. ¿Qué otro día te sirve?`
  // Spoken times: the result is read aloud verbatim.
  const spoken = (hhmm: string) => formatTimeFromISO(localToUTC(date, hhmm, ctx.timezone), ctx.timezone)
  return `Eso queda fuera del horario: ese día se atiende de ${spoken(outside.open)} a ${spoken(outside.close)}, y la cita debe terminar antes de cerrar. ¿A qué hora la pongo?`
}
