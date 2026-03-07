import type { Metadata } from 'next'
import {
  TrendingUp, TrendingDown, DollarSign, CreditCard,
  Receipt, Plus, ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import { StatCard, Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mockTransactions, mockExpenses, mockFinanceSummary } from '@/lib/mock/data'
import { formatCurrency, formatDate, paymentMethodLabels, expenseCategoryLabels } from '@/lib/utils'

export const metadata: Metadata = { title: 'Finanzas' }

export default function FinancesPage() {
  const summary = mockFinanceSummary

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finanzas</h1>
          <p className="text-muted-foreground text-sm">Resumen financiero del mes</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/finances/expense">
            <Button variant="secondary" leftIcon={<Receipt size={16} />}>Registrar Gasto</Button>
          </Link>
          <Link href="/dashboard/finances/new">
            <Button leftIcon={<Plus size={16} />}>Registrar Cobro</Button>
          </Link>
        </div>
      </div>

      {/* Finance KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Ingresos del mes"
          value={formatCurrency(summary.totalRevenue)}
          icon={<TrendingUp size={22} />}
          trend={{ value: 12, label: 'vs mes anterior' }}
          accent
        />
        <StatCard
          title="Gastos del mes"
          value={formatCurrency(summary.totalExpenses)}
          icon={<TrendingDown size={22} />}
          trend={{ value: -5, label: 'vs mes anterior' }}
        />
        <StatCard
          title="Ganancia neta"
          value={formatCurrency(summary.netProfit)}
          subtitle={`Margen: ${Math.round((summary.netProfit / summary.totalRevenue) * 100)}%`}
          icon={<DollarSign size={22} />}
        />
      </div>

      {/* Profit bar */}
      <Card>
        <h2 className="text-sm font-semibold text-foreground mb-4">Distribución del mes</h2>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Ingresos</span>
              <span>{formatCurrency(summary.totalRevenue)}</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-brand-600 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Gastos</span>
              <span>{formatCurrency(summary.totalExpenses)}</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-red-400 rounded-full"
                style={{ width: `${(summary.totalExpenses / summary.totalRevenue) * 100}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-foreground font-medium mb-1.5">
              <span>Ganancia neta</span>
              <span>{formatCurrency(summary.netProfit)}</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${(summary.netProfit / summary.totalRevenue) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Transactions & Expenses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transactions */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Últimos cobros</h2>
            <Link href="/dashboard/finances/transactions" className="text-sm text-brand-600 hover:underline flex items-center gap-1">
              Ver todo <ArrowRight size={14} />
            </Link>
          </div>
          {mockTransactions.length === 0 ? (
            <div className="text-center py-8">
              <CreditCard size={36} className="text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">No hay cobros registrados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {mockTransactions.map((txn) => (
                <div key={txn.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                  <div className="h-9 w-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                    <DollarSign size={16} className="text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {paymentMethodLabels[txn.method]}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(txn.paidAt, 'd MMM, HH:mm')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-green-600">+{formatCurrency(txn.netAmount)}</p>
                    {txn.discount > 0 && (
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
            <Link href="/dashboard/finances/expenses" className="text-sm text-brand-600 hover:underline flex items-center gap-1">
              Ver todo <ArrowRight size={14} />
            </Link>
          </div>
          {mockExpenses.length === 0 ? (
            <div className="text-center py-8">
              <Receipt size={36} className="text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">No hay gastos registrados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {mockExpenses.map((exp) => (
                <div key={exp.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                  <div className="h-9 w-9 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                    <Receipt size={16} className="text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {expenseCategoryLabels[exp.category]}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{exp.description}</p>
                  </div>
                  <p className="text-sm font-semibold text-red-600">-{formatCurrency(exp.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
