/**
 * Finances Repository — Supabase queries for transactions and expenses.
 *
 * Exposes:
 *  - getTransactions
 *  - getExpenses
 *  - createTransaction
 *  - createExpense
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ExpenseRow, TransactionRow } from '@/types'

type Client = SupabaseClient<Database>

/**
 * Returns all transactions for a business.
 */
export async function getTransactions(
  supabase: Client,
  businessId: string,
  options?: { limit?: number }
): Promise<TransactionRow[]> {
  let query = supabase
    .from('transactions')
    .select('id, business_id, appointment_id, amount, net_amount, discount, tip, method, notes, paid_at, created_at')
    .eq('business_id', businessId)
    .order('paid_at', { ascending: false })

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) throw new Error(`Error fetching transactions: ${error.message}`)
  return (data ?? []) as TransactionRow[]
}

/**
 * Returns all expenses for a business.
 */
export async function getExpenses(
  supabase: Client,
  businessId: string
): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, business_id, category, amount, description, expense_date, created_at, created_by, receipt_url')
    .eq('business_id', businessId)
    .order('expense_date', { ascending: false })

  if (error) throw new Error(`Error fetching expenses: ${error.message}`)
  return (data ?? []) as ExpenseRow[]
}

/**
 * Creates a transaction record.
 */
export async function createTransaction(
  supabase: Client,
  data: {
    business_id: string
    client_id?: string
    appointment_id?: string | null
    amount: number
    net_amount: number
    discount?: number
    tip?: number
    method: Database['public']['Enums']['payment_method']
    notes?: string | null
    paid_at?: string
  }
) {
  const { error } = await supabase
    .from('transactions')
    .insert({
      ...data,
      paid_at: data.paid_at ?? new Date().toISOString(),
    })

  if (error) throw new Error(`Error creating transaction: ${error.message}`)
}

/**
 * Creates an expense record.
 */
export async function createExpense(
  supabase: Client,
  data: {
    business_id: string
    category: Database['public']['Enums']['expense_category']
    amount: number
    description?: string | null
    expense_date: string
  }
) {
  const { error } = await supabase
    .from('expenses')
    .insert(data)

  if (error) throw new Error(`Error creating expense: ${error.message}`)
}

/**
 * Returns transactions for a date range (for revenue stats + forecast).
 */
export async function findByPaidAtRange(
  supabase: Client,
  businessId: string,
  from: string,
  to: string
): Promise<{ net_amount: number; paid_at: string }[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('net_amount, paid_at')
    .eq('business_id', businessId)
    .gte('paid_at', from)
    .lte('paid_at', to)

  if (error) throw new Error(`findByPaidAtRange: ${error.message}`)
  return (data ?? []).map(row => ({
    net_amount: row.net_amount,
    paid_at: row.paid_at ?? new Date().toISOString()
  }))
}
