/**
 * finance.tools.ts — AI read tool for the dashboard voice greeting.
 *
 * Only `get_today_summary` survives: it is the single AI tool still wired to a
 * live route (`app/api/assistant/proactive` builds the voice welcome message).
 * The rest of the Node AI tool layer (booking/client/crm write+read tools + the
 * ReAct planner) was removed — the live assistant is the Deno voice-worker.
 */

import { z } from 'zod'
import { startOfDay, endOfDay, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { logger } from '@/lib/logger'
import type { ToolContext } from './_context'

// ── SCHEMAS ────────────────────────────────────────────────────────────────

export const GetTodaySummarySchema = z.object({
  business_id: z.string().uuid(),
})

// ── READ: Resumen del día ──────────────────────────────────────────────────

export async function get_today_summary(
  args: z.infer<typeof GetTodaySummarySchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetTodaySummarySchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.message}`
  const { business_id } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  try {
    const todayStart = startOfDay(new Date()).toISOString()
    const todayEnd   = endOfDay(new Date()).toISOString()

    const [txsResult, apptsResult] = await Promise.all([
      ctx.financeRepo.findByPaidAtRange(business_id, todayStart, todayEnd),
      ctx.appointmentRepo.findByDateRange(business_id, todayStart, todayEnd),
    ])

    if (txsResult.error || !txsResult.data || apptsResult.error || !apptsResult.data) {
      return 'Error al consultar el resumen del día. Intenta de nuevo en un momento.'
    }

    const totalIncome = txsResult.data.reduce((acc, r) => acc + Number(r.net_amount), 0)
    const appts       = apptsResult.data
    const completed   = appts.filter(a => a.status === 'completed').length
    const pending     = appts.filter(a => a.status === 'pending' || a.status === 'confirmed').length
    const cancelled   = appts.filter(a => a.status === 'cancelled' || a.status === 'no_show').length
    const todayStr    = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

    return `Resumen para hoy ${todayStr}: facturado hoy $${totalIncome.toLocaleString('es-CO')}. Citas: ${appts.length} en total, ${completed} atendidas, ${pending} pendientes, ${cancelled} canceladas.`
  } catch (err: unknown) {
    logger.error('TOOL-DB', `get_today_summary failed: ${err instanceof Error ? err.message : String(err)}`, { business_id })
    return 'Error al consultar el resumen del día. Intenta de nuevo en un momento.'
  }
}
