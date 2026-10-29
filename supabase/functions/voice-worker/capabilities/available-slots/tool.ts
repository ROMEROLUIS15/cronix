import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { localToUTC, humanizeDate, formatTimeFromISO } from '../../core/time-format.ts'
import { computeAvailableSlots, type WorkingHours } from '../../../_shared/availability.ts'
import { bookedSlotsOnDay } from '../../../_shared/booked-slots.ts'

export interface AvailableSlotsArgs extends Record<string, unknown> {
  date:         string
  duration_min: number
}

// The voice agent's context names days in full ({ monday: { open, close } }); the
// shared resolver reads the dashboard's stored shape ({ mon: [open, close] }).
const STORED_DAY_KEY: Record<string, string> = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
}

function storedWorkingHours(hours: ToolContext['workingHours']): WorkingHours {
  if (!hours) return undefined
  return Object.fromEntries(
    Object.entries(hours).map(([day, h]) => [STORED_DAY_KEY[day] ?? day, h ? [h.open, h.close] : null]),
  ) as WorkingHours
}

export async function executeAvailableSlots(
  ctx:  ToolContext,
  args: AvailableSlotsArgs,
): Promise<ToolResult> {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
  }
  if (!args.duration_min || args.duration_min < 5 || args.duration_min > 480) {
    return { success: false, result: 'Necesito una duración entre 5 y 480 minutos.' }
  }

  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', timeZone: ctx.timezone,
  }).format(new Date(`${args.date}T12:00:00Z`)).toLowerCase()

  const wh = ctx.workingHours?.[dayOfWeek]
  if (ctx.workingHours && Object.prototype.hasOwnProperty.call(ctx.workingHours, dayOfWeek) && !wh) {
    return { success: true, result: `El negocio está cerrado el ${humanizeDate(args.date, ctx.timezone)}.` }
  }

  const booked = await bookedSlotsOnDay(ctx.supabase, ctx.businessId, args.date, ctx.timezone)
  if (booked.error) return { success: false, result: `Error al consultar disponibilidad: ${booked.error}`, error: 'DB_ERROR' }

  const { slots } = computeAvailableSlots({
    workingHours: storedWorkingHours(ctx.workingHours),
    date:         args.date,
    timezone:     ctx.timezone,
    durationMin:  args.duration_min,
    bookedSlots:  booked.slots,
  })
  // Spoken time ("9 de la mañana") instead of raw 24h — the result text is
  // read aloud verbatim (bypassLLM), so "09:00" would be mispronounced.
  const free = slots.map((slot) => formatTimeFromISO(localToUTC(args.date, slot, ctx.timezone), ctx.timezone))

  const dateLabel = humanizeDate(args.date, ctx.timezone)
  if (!free.length) return { success: true, result: `No hay horarios libres el ${dateLabel}.` }
  return { success: true, result: `Horarios libres el ${dateLabel}: ${free.join(', ')}.` }
}
