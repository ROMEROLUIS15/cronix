'use client'

import { useState } from 'react'
import { DollarSign, CheckCircle2, ChevronRight, Hash } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { registerClientPayment } from '../actions'

interface Props {
  businessId: string
  clientId: string
  totalDebt: number
}

export function DebtActionDialog({ businessId, clientId, totalDebt }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'options' | 'abono' | 'pagado'>('options')
  const [form, setForm] = useState({
    amount: '',
    method: 'cash' as 'other' | 'cash' | 'card' | 'transfer' | 'qr',
    reference: ''
  })

  const reset = () => {
    setOpen(false)
    setMode('options')
    setForm({ amount: '', method: 'cash', reference: '' })
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setLoading(true)

    const amountToRegister = mode === 'pagado' ? totalDebt : parseFloat(form.amount)

    try {
      await registerClientPayment({
        business_id: businessId,
        client_id: clientId,
        amount: amountToRegister,
        method: form.method,
        notes: form.reference ? `Ref: ${form.reference}` : undefined
      })
      reset()
    } catch (error: any) {
      alert('Error: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  if (totalDebt <= 0) return null

  return (
    <>
      <button 
        onClick={() => setOpen(true)}
        className="w-full text-left transition-transform active:scale-[0.98] group"
      >
        <Card className="flex items-center justify-between p-5 bg-red-500/10 border-red-500/20 hover:bg-red-500/15 transition-all duration-300">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-500/20 rounded-2xl text-red-500 group-hover:scale-110 transition-transform">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="font-black text-red-500 text-lg">Deuda Pendiente</p>
              <p className="text-sm text-red-500/70">Pulsa para gestionar el pago</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-3xl font-black text-red-500 tracking-tighter">
              {formatCurrency(totalDebt)}
            </p>
            <ChevronRight size={20} className="text-red-500/40" />
          </div>
        </Card>
      </button>

      <Modal
        open={open}
        onClose={reset}
        title="Gestionar Deuda"
        description="Selecciona una acción para el saldo pendiente de este cliente."
      >
        {mode === 'options' && (
          <div className="grid grid-cols-1 gap-3 py-2">
            <button
              onClick={() => setMode('pagado')}
              className="flex items-center justify-between p-4 rounded-2xl border border-brand-500/20 bg-brand-500/5 hover:bg-brand-500/10 transition-colors text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-500/20 rounded-xl text-brand-500">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <p className="font-bold text-foreground">Marcar como Pagado</p>
                  <p className="text-xs text-muted-foreground">El cliente pagó el total: {formatCurrency(totalDebt)}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-muted-foreground/30 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => {
                setForm(f => ({ ...f, amount: totalDebt.toString() }))
                setMode('abono')
              }}
              className="flex items-center justify-between p-4 rounded-2xl border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10 transition-colors text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/20 rounded-xl text-orange-500">
                  <DollarSign size={20} />
                </div>
                <div>
                  <p className="font-bold text-foreground">Registrar Abono</p>
                  <p className="text-xs text-muted-foreground">Pago parcial del saldo pendiente</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-muted-foreground/30 group-hover:translate-x-1 transition-transform" />
            </button>

            <Button variant="secondary" onClick={reset} className="mt-2 py-3 rounded-2xl">
              Cerrar (Mantener Deuda)
            </Button>
          </div>
        )}

        {mode !== 'options' && (
          <form onSubmit={handleSubmit} className="space-y-5 py-2">
            {mode === 'abono' && (
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Monto del abono</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                  <input
                    type="number" step="0.01" required autoFocus
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="input-base pl-10 py-4 text-lg font-bold"
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}

            {mode === 'pagado' && (
              <div className="p-4 rounded-2xl bg-brand-500/5 border border-brand-500/10 mb-2">
                <p className="text-sm text-center font-medium">Confirmando pago total de <span className="text-brand-500 font-black">{formatCurrency(totalDebt)}</span></p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Método</label>
                <select
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value as any })}
                  className="input-base bg-card py-4"
                >
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="transfer">Transferencia</option>
                  <option value="qr">QR</option>
                  <option value="other">Otro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Referencia</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"><Hash size={14} /></span>
                  <input
                    type="text"
                    value={form.reference}
                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    className="input-base pl-10 py-4"
                    placeholder="Opcional"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => setMode('options')} className="flex-1 py-4 rounded-2xl">
                Atrás
              </Button>
              <Button type="submit" loading={loading} className="flex-[2] py-4 rounded-2xl" leftIcon={<CheckCircle2 size={18} />}>
                {mode === 'pagado' ? 'Confirmar Pago' : 'Guardar Abono'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
