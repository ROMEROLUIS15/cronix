/**
 * finance.tools.ts — AI tools for financial read/write operations.
 */

import { z } from 'zod'
import { startOfDay, endOfDay, addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { fuzzyFind } from '@/lib/ai/fuzzy-match'
import { logger } from '@/lib/logger'
import type { ToolContext } from './_context'

// ── SCHEMAS ────────────────────────────────────────────────────────────────

export const GetTodaySummarySchema = z.object({
  business_id: z.string().uuid(),
})

export const RegisterPaymentSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
  amount: z.number().positive().max(100_000_000, 'Monto fuera de los límites de seguridad'),
  method: z.enum(['efectivo', 'tarjeta', 'transferencia', 'qr', 'cash', 'card', 'transfer']).default('efectivo'),
})

export const GetRevenueStatsSchema = z.object({
  business_id: z.string().uuid(),
})

const PAYMENT_METHOD_MAP: Record<string, string> = {
  efectivo:      'cash',
  tarjeta:       'card',
  transferencia: 'transfer',
  qr:            'qr',
  cash:          'cash',
  card:          'card',
  transfer:      'transfer',
}

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

// ── WRITE: Registrar pago ──────────────────────────────────────────────────

export async function register_payment(
  args: z.infer<typeof RegisterPaymentSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = RegisterPaymentSchema.safeParse(args)
  if (!parse.success) return `Error en los datos del cobro: ${parse.error.issues[0]?.message}`
  const { business_id, client_name, amount, method } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const normalizedMethod = PAYMENT_METHOD_MAP[method.toLowerCase()] ?? 'other'

  const clientsResult = await ctx.clientRepo.findActiveForAI(business_id)
  if (clientsResult.error || !clientsResult.data) return `En este momento no puedo verificar el cliente ${client_name}.`

  const clientMatch = fuzzyFind(clientsResult.data, client_name)
  if (clientMatch.status !== 'found') return `No encontré al cliente ${client_name}.`

  const client = clientMatch.match

  const txResult = await ctx.financeRepo.createTransaction({
    business_id,
    client_id:  client.id,
    amount,
    net_amount: amount,
    method:     normalizedMethod,
    paid_at:    new Date().toISOString(),
    notes:      'Registrado por voz — Luis IA',
  })

  if (txResult.error) {
    logger.error('TOOL-DB', `register_payment failed: ${txResult.error}`, { business_id })
    return 'No pude registrar el cobro por un error técnico.'
  }

  return `Listo. Registré un cobro de $${amount.toLocaleString('es-CO')} a ${client.name}.`
}

// ── STRATEGIC: Estadísticas de ingresos ────────────────────────────────────

export async function get_revenue_stats(
  args: z.infer<typeof GetRevenueStatsSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetRevenueStatsSchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.message}`
  const { business_id } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const startPrev    = addDays(new Date(), -14).toISOString()
  const startCurrent = addDays(new Date(), -7).toISOString()

  const result = await ctx.financeRepo.findByPaidAtRange(business_id, startPrev, new Date().toISOString())

  if (result.error || !result.data) return 'Error al calcular estadísticas.'

  const currentTotal  = result.data.filter(t => new Date(t.paid_at) >= new Date(startCurrent)).reduce((acc, t) => acc + Number(t.net_amount), 0)
  const previousTotal = result.data.filter(t => new Date(t.paid_at) <  new Date(startCurrent)).reduce((acc, t) => acc + Number(t.net_amount), 0)

  let diffStr = ''
  if (previousTotal > 0) {
    const diff = ((currentTotal - previousTotal) / previousTotal) * 100
    diffStr = ` — eso es un ${diff.toFixed(1)}% ${diff >= 0 ? 'más' : 'menos'} que la semana pasada.`
  }

  return `En los últimos 7 días has facturado $${currentTotal.toLocaleString('es-CO')}${diffStr}`
}
