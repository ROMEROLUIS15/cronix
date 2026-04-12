/**
 * SupabaseFinanceRepository — Concrete implementation of IFinanceRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail } from '@/types/result'
import {
  IFinanceRepository,
  CreateTransactionPayload,
  CreateExpensePayload,
  RevenueDataPoint
} from '@/lib/domain/repositories/IFinanceRepository'
import type { ExpenseRow, TransactionRow } from '@/types'

type Client = SupabaseClient<Database>

export class SupabaseFinanceRepository implements IFinanceRepository {
  constructor(private supabase: Client) {}

  async getTransactions(
    businessId: string,
    options?: { limit?: number }
  ): Promise<Result<TransactionRow[]>> {
    let query = this.supabase
      .from('transactions')
      .select('id, business_id, appointment_id, amount, net_amount, discount, tip, method, notes, paid_at, created_at')
      .eq('business_id', businessId)
      .order('paid_at', { ascending: false })

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    const { data, error } = await query
    if (error) return fail(`Error fetching transactions: ${error.message}`)
    return ok((data ?? []) as TransactionRow[])
  }

  async getExpenses(businessId: string): Promise<Result<ExpenseRow[]>> {
    const { data, error } = await this.supabase
      .from('expenses')
      .select('id, business_id, category, amount, description, expense_date, created_at, created_by, receipt_url')
      .eq('business_id', businessId)
      .order('expense_date', { ascending: false })

    if (error) return fail(`Error fetching expenses: ${error.message}`)
    return ok((data ?? []) as ExpenseRow[])
  }

  async createTransaction(payload: CreateTransactionPayload): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('transactions')
      .insert({
        ...payload,
        paid_at: payload.paid_at ?? new Date().toISOString(),
        method: payload.method as Database['public']['Enums']['payment_method']
      })

    if (error) return fail(`Error creating transaction: ${error.message}`)
    return ok(undefined)
  }

  async createExpense(payload: CreateExpensePayload): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('expenses')
      .insert({
        ...payload,
        category: payload.category as Database['public']['Enums']['expense_category']
      })

    if (error) return fail(`Error creating expense: ${error.message}`)
    return ok(undefined)
  }

  async findByPaidAtRange(
    businessId: string,
    from: string,
    to: string
  ): Promise<Result<RevenueDataPoint[]>> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select('net_amount, paid_at')
      .eq('business_id', businessId)
      .gte('paid_at', from)
      .lte('paid_at', to)

    if (error) return fail(`findByPaidAtRange: ${error.message}`)
    return ok((data ?? []).map(row => ({
      net_amount: row.net_amount,
      paid_at: row.paid_at ?? new Date().toISOString()
    })))
  }

  async sumNetAmount(
    businessId: string,
    from: string,
    to: string
  ): Promise<Result<number>> {
    // Use PostgREST aggregate: select=sum(net_amount)
    // This pushes the SUM to the DB — no row-by-row fetch.
    const { data, error } = await this.supabase
      .from('transactions')
      .select('sum:net_amount.sum()')
      .eq('business_id', businessId)
      .gte('paid_at', from)
      .lte('paid_at', to)
      .single()

    if (error) return fail(`sumNetAmount: ${error.message}`)
    // PostgREST returns aggregate as { sum: string | number } when using select='sum:net_amount.sum()'
    const aggregate = data as { sum: number | string } | null
    return ok(aggregate ? Number(aggregate.sum) : 0)
  }
}
