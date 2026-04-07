'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Receipt, Search, Plus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency, formatDate, expenseCategoryLabels } from '@/lib/utils'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as financesRepo from '@/lib/repositories/finances.repo'
import type { ExpenseRow } from '@/types'

export default function ExpensesPage() {
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()
  const [query, setQuery] = useState('')
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoading(false)
      return
    }

    async function loadExpenses() {
      try {
        const data = await financesRepo.getExpenses(supabase, businessId!)
        setExpenses(data)
        setFetchError(null)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'No se pudieron cargar los gastos')
      } finally {
        setLoading(false)
      }
    }

    loadExpenses()
  }, [supabase, businessId, contextLoading])

  // Filtro con blindaje defensivo
  const filtered = expenses.filter((e) => {
    const searchTerm = (query || '').toLowerCase()
    const description = String(e?.description || '').toLowerCase()
    const category = String(e?.category || '').toLowerCase()
    
    return description.includes(searchTerm) || category.includes(searchTerm)
  })

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-2">
        <p className="text-sm font-medium" style={{ color: '#FF3B30' }}>No se pudieron cargar los gastos</p>
        <p className="text-xs" style={{ color: '#8A8A90' }}>{fetchError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/finances" className="btn-ghost p-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Historial de Gastos</h1>
            <p className="text-muted-foreground text-sm">{expenses.length} egresos registrados</p>
          </div>
        </div>
        <Link href="/dashboard/finances/expense">
          <Button variant="secondary" leftIcon={<Plus size={16} />}>Registrar Gasto</Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar gasto..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input-base pl-10"
        />
      </div>

      {/* List */}
      <Card className="p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Receipt size={40} className="text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground">No se encontraron gastos para &quot;{query}&quot;</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((exp) => (
              <div key={exp.id} className="flex items-center gap-4 px-5 py-4 hover:bg-surface transition-colors">
                <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <Receipt size={18} className="text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">
                    {expenseCategoryLabels[exp.category] ?? 'Gasto General'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(exp.expense_date, 'd MMM yyyy')} · {exp.description || 'Sin descripción'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-bold text-red-600">-{formatCurrency(exp.amount || 0)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
