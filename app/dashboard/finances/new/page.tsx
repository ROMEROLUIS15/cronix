'use client'

import { useState } from 'react'
import { ArrowLeft, DollarSign } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { mockClients, mockServices } from '@/lib/mock/data'

export default function NewFinancePage() {
  const [form, setForm] = useState({
    amount:   '',
    method:   'cash',
    clientId: '',
    serviceId:'',
    notes:    '',
    date:     '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await new Promise((r) => setTimeout(r, 1000))
    setSaving(false)
    alert('✅ Ingreso registrado correctamente')
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
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="method">
                  Método de pago *
                </label>
                <select
                  id="method"
                  required
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                  className="input-base bg-card"
                >
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta de Crédito/Débito</option>
                  <option value="transfer">Transferencia Bancaria</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="date">
                  Fecha del pago *
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
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="client">
                  Cliente (opcional)
                </label>
                <select
                  id="client"
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  className="input-base bg-card"
                >
                  <option value="">Seleccionar cliente...</option>
                  {mockClients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="service">
                Concepto / Servicio (opcional)
              </label>
              <select
                id="service"
                value={form.serviceId}
                onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                className="input-base bg-card"
              >
                <option value="">Servicio general u otro concepto...</option>
                {mockServices.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="notes">
                Nota aclaratoria (opcional)
              </label>
              <textarea
                id="notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="input-base resize-none"
                placeholder="Razón del pago extra, referencias..."
              />
            </div>
          </div>
        </Card>

        {/* Actions */}
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
