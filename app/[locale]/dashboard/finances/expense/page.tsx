'use client'

import { useState } from 'react'
import { ArrowLeft, Receipt } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { expenseCategoryLabels } from '@/lib/utils'
import type { ExpenseCategory } from '@/types'

const CATEGORIES = Object.entries(expenseCategoryLabels) as [ExpenseCategory, string][]

export default function NewExpensePage() {
  const router = useRouter()
  const { supabase, businessId } = useBusinessContext()

  const [form, setForm] = useState({
    category: 'supplies' as ExpenseCategory,
    amount:   '',
    description: '',
    date:     new Date().toISOString().split('T')[0] as string,
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return

    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount <= 0) {
      setMsg({ type: 'error', text: 'Ingresa un monto válido mayor a 0.' })
      return
    }

    setSaving(true)
    setMsg(null)

    try {
      const { createExpense } = await import('@/lib/repositories/finances.repo')
      await createExpense(supabase, {
        business_id:  businessId,
        category:     form.category,
        amount,
        description:  form.description.trim() || null,
        expense_date: form.date,
      })

      router.push('/dashboard/finances/expenses')
      router.refresh()
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Error al registrar el gasto.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/finances" className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground">
        <ArrowLeft size={16} /> Volver a Finanzas
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Registrar Gasto</h1>
        <p className="text-muted-foreground text-sm">Registra un egreso o gasto operativo</p>
      </div>

      {msg && (
        <div className={`text-sm font-medium px-4 py-3 rounded-lg ${msg.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'}`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <Receipt size={18} className="text-red-600" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Detalles del gasto</h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="amount">
                  Monto *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <input
                    id="amount" type="number" required min="1" step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="input-base pl-8" placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="category">
                  Categoría *
                </label>
                <select id="category" required value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}
                  className="input-base bg-card"
                >
                  {CATEGORIES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="date">
                Fecha del gasto *
              </label>
              <input id="date" type="date" required value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="input-base"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="description">
                Descripción (opcional)
              </label>
              <textarea id="description" rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="input-base resize-none"
                placeholder="Detalle del gasto..."
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Link href="/dashboard/finances">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={saving} leftIcon={<Receipt size={16} />}>
            Guardar Gasto
          </Button>
        </div>
      </form>
    </div>
  )
}
