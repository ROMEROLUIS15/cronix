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
}
