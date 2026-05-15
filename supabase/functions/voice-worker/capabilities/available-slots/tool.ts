import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { localToUTC, buildEndISO } from '../../core/time-format.ts'

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
    return { success: true, result: `El negocio está cerrado el ${args.date}.` }
  }

  const open  = wh?.open  ?? '09:00'
  const close = wh?.close ?? '18:00'

  const { data: booked, error } = await ctx.supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', `${args.date}T00:00:00`)
    .lte('start_at', `${args.date}T23:59:59`)
    .order('start_at')

  if (error) return { success: false, result: `Error al consultar disponibilidad: ${error.message}` }

  const free: string[] = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)

  for (let h = oh!; h < ch!; h++) {
    for (let m = (h === oh ? om! : 0); m < 60; m += SLOT_INTERVAL) {
      if (h === ch && m >= cm!) break
      const candidateTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const startISO = localToUTC(args.date, candidateTime, ctx.timezone)
      const endISO   = buildEndISO(startISO, args.duration_min)
      const conflict = (booked ?? []).some((b: { start_at: string; end_at: string }) =>
        new Date(b.start_at) < new Date(endISO) && new Date(b.end_at) > new Date(startISO)
      )
      if (!conflict) free.push(candidateTime)
    }
  }

  if (!free.length) return { success: true, result: `No hay horarios libres para el ${args.date}.` }
  return { success: true, result: `Horarios libres el ${args.date}: ${free.join(', ')}.` }
}
