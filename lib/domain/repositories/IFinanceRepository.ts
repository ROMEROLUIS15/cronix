/**
 * IFinanceRepository — Domain contract for financial data persistence.
 *
 * Exposes: transaction and expense read/write operations.
 * Does not expose: Supabase, HTTP, or infrastructure details.
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { TransactionRow, ExpenseRow } from '@/types'

export type CreateTransactionPayload = {
  business_id: string
  client_id?: string
  appointment_id?: string | null
  amount: number
  net_amount: number
  discount?: number
  tip?: number
  method: string
  notes?: string | null
  paid_at?: string
  /** Client-generated UUID. When present, duplicate inserts with the same key are silently ignored. */
  idempotency_key?: string
}

export type CreateExpensePayload = {
  business_id: string
  category: string
  amount: number
  description?: string | null
  expense_date: string
}

export type RevenueDataPoint = {
  net_amount: number
  paid_at: string
}

/**
 * Canonical monthly metrics for a business, computed by the DB in a single
 * round-trip. The ONE source of truth shared by Home, Finances and Reports.
 *
 * Both revenue figures are attributed to a month by the appointment date
 * (start_at); transactions without a linked appointment fall back to paid_at.
 *
 *  - billed:    value of services rendered (list price of completed appointments)
 *  - collected: real cash in (net_amount of transactions)
 *  - expenses:  total expenses dated within the month
 */
export type MonthlyMetrics = {
  billed:    number
  collected: number
  expenses:  number
}

/**
 * A single item in an atomic batch insert.
 * Omits business_id — it is passed once at the batch level to avoid
 * repetition and prevent cross-business data leaks.
 */
export type BatchTransactionItem = Omit<CreateTransactionPayload, 'business_id'>

export interface IFinanceRepository {
  /**
   * Returns all transactions for a business.
   */
  getTransactions(
    businessId: string,
    options?: { limit?: number }
  ): Promise<Result<TransactionRow[]>>

  /**
   * Returns all expenses for a business.
   */
  getExpenses(businessId: string): Promise<Result<ExpenseRow[]>>

  /**
   * Creates a transaction record.
   */
  createTransaction(payload: CreateTransactionPayload): Promise<Result<void>>

  /**
   * Creates an expense record.
   */
  createExpense(payload: CreateExpensePayload): Promise<Result<void>>

  /**
   * Returns transactions in a date range for revenue stats.
   */
  findByPaidAtRange(
    businessId: string,
    from: string,
    to: string
  ): Promise<Result<RevenueDataPoint[]>>

  /**
   * Returns the SUM of net_amount for transactions in a date range.
   * Pushes aggregation to the DB — avoids fetching all rows to sum in JS.
   */
  sumNetAmount(
    businessId: string,
    from: string,
    to: string
  ): Promise<Result<number>>

  /**
   * Returns the canonical monthly metrics (billed / collected / expenses) for
   * the calendar month containing `monthStart`. Computed entirely in the DB —
   * the single source of truth for every dashboard revenue figure.
   *
   * @param monthStart Any date within the target month (YYYY-MM-DD).
   */
  getMonthlyMetrics(
    businessId: string,
    monthStart: string
  ): Promise<Result<MonthlyMetrics>>

  /**
   * Atomically inserts multiple transactions in a single DB transaction.
   * If any insert fails, all are rolled back — prevents partial payment state.
   * Respects idempotency_key per item (same semantics as createTransaction).
   */
  createTransactionBatch(
    businessId: string,
    items: BatchTransactionItem[]
  ): Promise<Result<void>>
}
