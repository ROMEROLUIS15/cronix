'use client'

import { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, CreditCard,
  Receipt, Plus, ArrowRight, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { StatCard, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  formatCurrency, formatDate,
  paymentMethodLabels, expenseCategoryLabels,
} from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// ── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  id:         string
  net_amount: number
  method:     string
  discount:   number | null
  paid_at:    string | null
}

interface Expense {
  id:           string
  amount:       number
  category:     string | null
  description:  string | null
  expense_date: string | null
}

interface Summary {
  totalRevenue:  number
  totalExpenses: number
  netProfit:     number
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FinancesPage() {
  const supabase = createClient()

  const [loading,            setLoading]            = useState(true)
  const [summary,            setSummary]            = useState<Summary>({ totalRevenue: 0, totalExpenses: 0, netProfit: 0 })
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([])
  const [recentExpenses,     setRecentExpenses]     = useState<Expense[]>([])

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: dbUser } = await supabase
        .from('users')
        .select('business_id')
        .eq('id', user.id)
        .single()

      if (!dbUser?.business_id) { setLoading(false); return }

      const bId = dbUser.business_id
      const startOfMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      ).toISOString()

      const [txnRes, expRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, net_amount, method, discount, paid_at')
          .eq('business_id', bId)
          .gte('paid_at', startOfMonth)
          .order('paid_at', { ascending: false }),
        supabase
          .from('expenses')
          .select('id, amount, category, description, expense_date')
          .eq('business_id', bId)
          .gte('expense_date', startOfMonth)
          .order('expense_date', { ascending: false }),
      ])

      const txns = (txnRes.data ?? []) as Transaction[]
      const exps = (expRes.data  ?? []) as Expense[]

      const totalRevenue  = txns.reduce((acc, t) => acc + (t.net_amount ?? 0), 0)
      const totalExpenses = exps.reduce((acc, e) => acc + (e.amount     ?? 0), 0)

      setRecentTransactions(txns.slice(0, 5))
      setRecentExpenses(exps.slice(0, 5))
      setSummary({ totalRevenue, totalExpenses, netProfit: totalRevenue - totalExpenses })
      setLoading(false)
    }
    loadData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#0062FF' }} />
      </div>
    )
  }

  const marginPct = summary.totalRevenue > 0
    ? Math.round((summary.netProfit / summary.totalRevenue) * 100)
    : 0

  const expensePct = summary.totalRevenue > 0
    ? Math.min((summary.totalExpenses / summary.totalRevenue) * 100, 100)
    : 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finanzas</h1>
          <p className="text-muted-foreground text-sm">Resumen financiero del mes actual</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/finances/expense">
            <Button variant="secondary" leftIcon={<Receipt size={16} />}>
              Registrar Gasto
            </Button>
          </Link>
          <Link href="/dashboard/finances/new">
            <Button leftIcon={<Plus size={16} />}>Registrar Cobro</Button>
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Ingresos del mes"
          value={formatCurrency(summary.totalRevenue)}
          icon={<TrendingUp size={22} />}
          accent
        />
        <StatCard
          title="Gastos del mes"
          value={formatCurrency(summary.totalExpenses)}
          icon={<TrendingDown size={22} />}
        />
        <StatCard
          title="Ganancia neta"
          value={formatCurrency(summary.netProfit)}
          subtitle={summary.totalRevenue > 0 ? `Margen: ${marginPct}%` : undefined}
          icon={<DollarSign size={22} />}
        />
      </div>

      {/* Distribution bar */}
      <Card>
        <h2 className="text-sm font-semibold text-foreground mb-4">
          Distribución del mes
        </h2>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Ingresos</span>
              <span>{formatCurrency(summary.totalRevenue)}</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: '100%', background: '#0062FF' }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Gastos</span>
              <span>{formatCurrency(summary.totalExpenses)}</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${expensePct}%`, background: '#FF3B30' }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Recent lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Transactions */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Últimos cobros</h2>
            <Link
              href="/dashboard/finances/transactions"
              className="text-sm flex items-center gap-1 hover:opacity-70 transition-opacity"
              style={{ color: '#0062FF' }}
            >
              Ver todo <ArrowRight size={14} />
            </Link>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="text-center py-8">
              <CreditCard size={36} className="mx-auto mb-2 opacity-30" style={{ color: '#909098' }} />
              <p className="text-sm text-muted-foreground">No hay cobros este mes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTransactions.map(txn => (
                <div
                  key={txn.id}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: '#1A1A1F' }}
                >
                  <div
                    className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(48,209,88,0.1)' }}
                  >
                    <DollarSign size={16} style={{ color: '#30D158' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {(paymentMethodLabels as Record<string, string>)[txn.method] ?? 'Pago'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {txn.paid_at ? formatDate(txn.paid_at, 'd MMM, HH:mm') : '—'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold" style={{ color: '#30D158' }}>
                      +{formatCurrency(txn.net_amount)}
                    </p>
                    {(txn.discount ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground">{txn.discount}% desc.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Expenses */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Últimos gastos</h2>
            <Link
              href="/dashboard/finances/expenses"
              className="text-sm flex items-center gap-1 hover:opacity-70 transition-opacity"
              style={{ color: '#0062FF' }}
            >
              Ver todo <ArrowRight size={14} />
            </Link>
          </div>

          {recentExpenses.length === 0 ? (
            <div className="text-center py-8">
              <Receipt size={36} className="mx-auto mb-2 opacity-30" style={{ color: '#909098' }} />
              <p className="text-sm text-muted-foreground">No hay gastos este mes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentExpenses.map(exp => (
                <div
                  key={exp.id}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: '#1A1A1F' }}
                >
                  <div
                    className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,59,48,0.1)' }}
                  >
                    <Receipt size={16} style={{ color: '#FF3B30' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {(expenseCategoryLabels as Record<string, string>)[exp.category ?? ''] ?? exp.category ?? 'Gasto'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {exp.description ?? '—'}
                    </p>
                  </div>
                  <p className="text-sm font-semibold flex-shrink-0" style={{ color: '#FF3B30' }}>
                    -{formatCurrency(exp.amount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  )
}
