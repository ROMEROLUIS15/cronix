/**
 * Finances Use Case — Pure business logic for financial calculations.
 *
 * NO framework dependencies. All functions are pure and independently testable.
 *
 * Exposes:
 *  - calculateClientDebt:      compute total debt from appointment + transaction data
 *  - calculateAppointmentDebt: compute debt for a single appointment
 *  - calculateMonthlySummary:  aggregate revenue, expenses and profit for a given month
 */

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

// ── Monthly finance summary ────────────────────────────────────────────────

interface TransactionInput {
  paid_at:    string | null
  net_amount: number | null
}

interface ExpenseInput {
  expense_date: string | null
  amount:       number | null
}

export interface FinanceMonthlySummary {
  totalRevenue:  number
  totalExpenses: number
  netProfit:     number
  marginPct:     number
  expensePct:    number
}

export interface MonthlySlices<T extends TransactionInput, E extends ExpenseInput> {
  monthTransactions: T[]
  monthExpenses:     E[]
  summary:           FinanceMonthlySummary
}

/**
 * Filters transactions and expenses to the current calendar month,
 * then computes revenue, expenses, profit and derived percentages.
 *
 * Pure function — no side effects, framework-agnostic, easily testable.
 * Safe to migrate: depends only on plain data shapes, not on Supabase types.
 *
 * @param transactions  Full list of transactions for the business
 * @param expenses      Full list of expenses for the business
 * @param referenceDate Month to compute (defaults to current month)
 */
export function calculateMonthlySummary<
  T extends TransactionInput,
  E extends ExpenseInput,
>(
  transactions: T[],
  expenses: E[],
  referenceDate: Date = new Date(),
): MonthlySlices<T, E> {
  const startOfMonth = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    1,
  ).toISOString()

  const monthTransactions = transactions.filter(t => (t.paid_at ?? '') >= startOfMonth)
  const monthExpenses     = expenses.filter(e => (e.expense_date ?? '') >= startOfMonth)

  const totalRevenue  = monthTransactions.reduce((acc, t) => acc + (t.net_amount ?? 0), 0)
  const totalExpenses = monthExpenses.reduce((acc, e) => acc + (e.amount ?? 0), 0)
  const netProfit     = totalRevenue - totalExpenses

  const marginPct  = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0
  const expensePct = totalRevenue > 0 ? Math.min((totalExpenses / totalRevenue) * 100, 100) : 0

  return {
    monthTransactions,
    monthExpenses,
    summary: { totalRevenue, totalExpenses, netProfit, marginPct, expensePct },
  }
}
