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
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as financesRepo from '@/lib/repositories/finances.repo'
import type { TransactionRow, ExpenseRow, PaymentMethod, ExpenseCategory } from '@/types'

// ── Component ──────────────────────────────────────────────────────────────
export default function FinancesPage() {
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()

  const [loading,            setLoading]            = useState(true)
  const [fetchError,         setFetchError]         = useState<string | null>(null)
  const [summary,            setSummary]            = useState({ totalRevenue: 0, totalExpenses: 0, netProfit: 0 })
  const [recentTransactions, setRecentTransactions] = useState<TransactionRow[]>([])
  const [recentExpenses,     setRecentExpenses]     = useState<ExpenseRow[]>([])

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoading(false)
      return
    }

    async function loadData() {
      try {
        const [txns, exps] = await Promise.all([
          financesRepo.getTransactions(supabase, businessId!),
          financesRepo.getExpenses(supabase, businessId!),
        ])

        // Filter to current month
        const startOfMonth = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        ).toISOString()

        const monthTxns = txns.filter(t => (t.paid_at ?? '') >= startOfMonth)
        const monthExps = exps.filter(e => (e.expense_date ?? '') >= startOfMonth)

        const totalRevenue  = monthTxns.reduce((acc, t) => acc + (t.net_amount ?? 0), 0)
        const totalExpenses = monthExps.reduce((acc, e) => acc + (e.amount     ?? 0), 0)

        setRecentTransactions(monthTxns.slice(0, 5))
        setRecentExpenses(monthExps.slice(0, 5))
        setSummary({ totalRevenue, totalExpenses, netProfit: totalRevenue - totalExpenses })
        setFetchError(null)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'No se pudieron cargar las finanzas')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [supabase, businessId, contextLoading])

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#0062FF' }} />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-2">
        <p className="text-sm font-medium" style={{ color: '#FF3B30' }}>No se pudieron cargar las finanzas</p>
        <p className="text-xs" style={{ color: '#8A8A90' }}>{fetchError}</p>
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
      <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finanzas</h1>
          <p className="text-muted-foreground text-sm">Resumen financiero del mes actual</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Link href="/dashboard/finances/expense" className="block flex-1 sm:flex-none">
            <Button variant="secondary" leftIcon={<Receipt size={16} />} className="w-full sm:w-auto">
              Registrar Gasto
            </Button>
          </Link>
          <Link href="/dashboard/finances/new" className="block flex-1 sm:flex-none">
            <Button leftIcon={<Plus size={16} />} className="w-full sm:w-auto">Registrar Cobro</Button>
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 xs:grid-cols-3 sm:grid-cols-3 gap-3 sm:gap-4">
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
                      {paymentMethodLabels[txn.method as PaymentMethod] ?? 'Pago'}
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
                      {expenseCategoryLabels[exp.category as ExpenseCategory] ?? exp.category ?? 'Gasto'}
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
