'use client'

import { useState } from 'react'
import { ArrowLeft, Receipt } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function ExpensePage() {
  const [form, setForm] = useState({
    amount:      '',
    category:    'supplies',
    description: '',
    date:        '',
    reference:   '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await new Promise((r) => setTimeout(r, 1000))
    setSaving(false)
    alert('✅ Gasto registrado correctamente')
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/finances" className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground">
        <ArrowLeft size={16} /> Volver a Finanzas
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Registrar Gasto</h1>
        <p className="text-muted-foreground text-sm">Registra una salida de dinero del negocio</p>
      </div>

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
                    id="amount"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="input-base pl-8"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="category">
                  Categoría *
                </label>
                <select
                  id="category"
                  required
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="input-base bg-card"
                >
                  <option value="salary">Salarios</option>
                  <option value="rent">Alquiler</option>
                  <option value="supplies">Suministros</option>
                  <option value="marketing">Marketing</option>
                  <option value="other">Otros</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="date">
                  Fecha del gasto *
                </label>
                <input
                  id="date"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="input-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="reference">
                  No. Referencia / Factura (opcional)
                </label>
                <input
                  id="reference"
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  className="input-base"
                  placeholder="FAC-1002, ticket..."
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="description">
                Descripción *
              </label>
              <textarea
                id="description"
                required
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="input-base resize-none"
                placeholder="Razón del gasto, proveedor..."
              />
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Link href="/dashboard/finances">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={saving} leftIcon={<Receipt size={16} />} className="bg-red-600 hover:bg-red-700 text-white">
            Guardar Gasto
          </Button>
        </div>
      </form>
    </div>
  )
}
