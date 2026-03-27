'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, DollarSign } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import type { PaymentMethod } from '@/types'

export default function NewFinancePage() {
  const router = useRouter()
  const { supabase, businessId } = useBusinessContext()

  const [form, setForm] = useState({
    amount:    '',
    method:    'cash' as PaymentMethod,
    notes:     '',
    date:      new Date().toISOString().split('T')[0],
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)

    const amount = parseFloat(form.amount)

    const { error } = await supabase.from('transactions').insert({
      business_id: businessId,
      amount,
      net_amount:  amount, // sin descuento ni propina por defecto
      method:      form.method,
      notes:       form.notes.trim() || null,
      paid_at: form.date ? new Date(form.date).toISOString() : null,
    })

    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: 'Error al registrar el ingreso.' })
    } else {
      router.push('/dashboard/finances')
      router.refresh()
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/finances" className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground">
        <ArrowLeft size={16} /> Volver a Finanzas
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Registrar Ingreso</h1>
        <p className="text-muted-foreground text-sm">Registra un pago manual o cobro adicional</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <DollarSign size={18} className="text-green-600" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Detalles del pago</h2>
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
                    id="amount" type="number" required min="0" step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="input-base pl-8" placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="method">
                  Método de pago *
                </label>
                <select id="method" required value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
                  className="input-base bg-card"
                >
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="transfer">Transferencia</option>
                  <option value="qr">QR</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="date">
                Fecha del pago *
              </label>
              <input id="date" type="date" required value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="input-base"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="notes">
                Nota aclaratoria (opcional)
              </label>
              <textarea id="notes" rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="input-base resize-none"
                placeholder="Razón del pago, referencias..."
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Link href="/dashboard/finances">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={saving} leftIcon={<DollarSign size={16} />}>
            Guardar Ingreso
          </Button>
        </div>
      </form>
    </div>
  )
}
