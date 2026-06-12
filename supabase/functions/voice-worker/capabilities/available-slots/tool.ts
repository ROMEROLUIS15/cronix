import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { localToUTC, buildEndISO, humanizeDate, formatTimeFromISO } from '../../core/time-format.ts'

export interface AvailableSlotsArgs extends Record<string, unknown> {
  date:         string
  duration_min: number
}

const SLOT_INTERVAL = 30

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

  const open  = wh?.open  ?? '09:00'
  const close = wh?.close ?? '18:00'

  // Bound the booked-set query by the LOCAL day converted to UTC — start_at is
  // stored in UTC, so naive `${date}T00:00:00` strings would query a UTC day
  // that's offset from the business's local day. In tz ≠ UTC that dropped
  // evening appointments from the conflict set and offered already-booked slots
  // as free. Mirror list-appointments' boundary handling.
  const dayStartISO = localToUTC(args.date, '00:00', ctx.timezone)
  const dayEndISO   = localToUTC(args.date, '23:59', ctx.timezone)

  const { data: booked, error } = await ctx.supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', dayStartISO)
    .lte('start_at', dayEndISO)
    .order('start_at')

  if (error) return { success: false, result: `Error al consultar disponibilidad: ${error.message}` }

  const free: string[] = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)

  // Minute-based walk with the invariant: the service must END by closing
  // time. The previous hour-based loop (h < ch) silently dropped the last
  // half-hour when close was fractional (close 18:30 never offered 18:00)
  // and never checked duration against close at all — a 120-min service at
  // 17:30 with close 18:00 was offered even though it ends 19:30.
  const openMin  = oh! * 60 + om!
  const closeMin = ch! * 60 + cm!
  for (let t = openMin; t + args.duration_min <= closeMin; t += SLOT_INTERVAL) {
    const candidateTime = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    const startISO = localToUTC(args.date, candidateTime, ctx.timezone)
    const endISO   = buildEndISO(startISO, args.duration_min)
    const conflict = (booked ?? []).some((b: { start_at: string; end_at: string }) =>
      new Date(b.start_at) < new Date(endISO) && new Date(b.end_at) > new Date(startISO)
    )
    // Spoken time ("9 de la mañana") instead of raw 24h — the result text is
    // read aloud verbatim (bypassLLM), so "09:00" would be mispronounced.
    if (!conflict) free.push(formatTimeFromISO(startISO, ctx.timezone))
  }

  const dateLabel = humanizeDate(args.date, ctx.timezone)
  if (!free.length) return { success: true, result: `No hay horarios libres el ${dateLabel}.` }
  return { success: true, result: `Horarios libres el ${dateLabel}: ${free.join(', ')}.` }
}
