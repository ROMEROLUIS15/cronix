/**
 * Finances Use Case — Pure business logic for financial calculations.
 *
 * NO framework dependencies. All functions are pure and independently testable.
 *
 * Exposes:
 *  - calculateClientDebt:      compute total debt from appointment + transaction data
 *  - calculateAppointmentDebt: compute debt for a single appointment
 *  - buildMonthlyFinanceView:  derive profit + ratios from canonical monthly metrics
 */

import type { MonthlyMetrics } from '@/lib/domain/repositories/IFinanceRepository'

interface AppointmentWithPayment {
  start_at: string
  status: string | null
  service: { price: number } | null
  transactions: Array<{ net_amount: number }>
}

/**
 * Calculates total unpaid debt for a client from their appointment history.
 * Only counts past appointments that are not cancelled/no_show.
 *
 * Pure function — no side effects, no DB calls.
 */
export function calculateClientDebt(
  appointments: AppointmentWithPayment[]
): number {
  const now = new Date()
  let totalDebt = 0

  for (const apt of appointments) {
    if (apt.status === 'cancelled' || apt.status === 'no_show') continue

    const startDate = new Date(apt.start_at)
    if (isNaN(startDate.getTime())) continue

    if (startDate >= now) continue

    const debt = calculateAppointmentDebt(apt)
    if (debt > 0) totalDebt += debt
  }

  return totalDebt
}

/**
 * Calculates remaining debt for a single appointment.
 * Returns positive number if client owes money, 0 if paid.
 */
export function calculateAppointmentDebt(apt: AppointmentWithPayment): number {
  const price = Number(apt.service?.price ?? 0)
  if (!isFinite(price) || price <= 0) return 0

  const paid = apt.transactions?.reduce(
    (sum, t) => {
      const amount = Number(t.net_amount ?? 0)
      return sum + (isFinite(amount) ? amount : 0)
    },
    0,
  ) ?? 0

  return Math.max(0, price - paid)
}

// ── Monthly finance view ───────────────────────────────────────────────────

/**
 * Presentation-ready monthly finances: the canonical metrics plus the derived
 * figures the dashboard renders. Profit and ratios are based on COLLECTED cash
 * (real money in), not billed value.
 */
export interface MonthlyFinanceView {
  billed:         number  // value of services rendered (list price of completed)
  collected:      number  // real cash collected
  expenses:       number  // expenses dated within the month
  netProfit:      number  // collected − expenses
  marginPct:      number  // netProfit / collected   (0–100, rounded)
  expensePct:     number  // expenses / collected    (0–100, capped)
  collectionRate: number  // collected / billed      (0–100, capped) — how much
                          // of the rendered value was actually collected
}

/**
 * Derives profit and ratios from the canonical monthly metrics returned by the
 * DB (`fn_get_monthly_metrics`). Pure function — no side effects, framework- and
 * Supabase-agnostic, trivially testable.
 */
export function buildMonthlyFinanceView(metrics: MonthlyMetrics): MonthlyFinanceView {
  const { billed, collected, expenses } = metrics
  const netProfit = collected - expenses

  const marginPct      = collected > 0 ? Math.round((netProfit / collected) * 100) : 0
  const expensePct     = collected > 0 ? Math.min((expenses / collected) * 100, 100) : 0
  const collectionRate = billed > 0 ? Math.min((collected / billed) * 100, 100) : 0

  return { billed, collected, expenses, netProfit, marginPct, expensePct, collectionRate }
}
