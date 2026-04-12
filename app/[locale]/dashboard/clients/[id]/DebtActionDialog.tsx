'use client'

import { useState } from 'react'
import { DollarSign, CheckCircle2, ChevronRight, Hash } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { registerClientPayment } from '../actions'
import type { PaymentMethod } from '@/types'
import { useTranslations } from 'next-intl'

interface Props {
  businessId: string
  clientId: string
  totalDebt: number
}

export function DebtActionDialog({ businessId, clientId, totalDebt }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'options' | 'abono' | 'pagado'>('options')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    amount: '',
    method: 'cash' as 'other' | 'cash' | 'card' | 'transfer' | 'qr',
    reference: ''
  })
  const t = useTranslations('clients.debt')

  const reset = () => {
    setOpen(false)
    setMode('options')
    setError(null)
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
    } catch {
      setError(t('paymentError'))
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
              <p className="font-black text-red-500 text-lg">{t('pendingDebt')}</p>
              <p className="text-sm text-red-500/70">{t('managePayment')}</p>
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
        title={t('manaDebtTitle')}
        description={t('selectAction')}
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
                  <p className="font-bold text-foreground">{t('markPaid')}</p>
                  <p className="text-xs text-muted-foreground">{t('paidFull', { amount: formatCurrency(totalDebt) })}</p>
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
                  <p className="font-bold text-foreground">{t('registerPayment')}</p>
                  <p className="text-xs text-muted-foreground">{t('partialPayment')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-muted-foreground/30 group-hover:translate-x-1 transition-transform" />
            </button>

            <Button variant="secondary" onClick={reset} className="mt-2 py-3 rounded-2xl">
              {t('close')}
            </Button>
          </div>
        )}

        {mode !== 'options' && (
          <form onSubmit={handleSubmit} className="space-y-5 py-2">
            {error && (
              <div className="p-3 rounded-xl text-xs font-medium"
                style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)', color: '#FF6B6B' }}>
                {error}
              </div>
            )}
            {mode === 'abono' && (
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">{t('amount')}</label>
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
                <p className="text-sm text-center font-medium">{t('confirmTotal')} <span className="text-brand-500 font-black">{formatCurrency(totalDebt)}</span></p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">{t('method')}</label>
                <select
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
                  className="input-base bg-card py-4"
                >
                  <option value="cash">{t('methods.cash')}</option>
                  <option value="card">{t('methods.card')}</option>
                  <option value="transfer">{t('methods.transfer')}</option>
                  <option value="qr">{t('methods.qr')}</option>
                  <option value="other">{t('methods.other')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">{t('reference')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"><Hash size={14} /></span>
                  <input
                    type="text"
                    value={form.reference}
                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    className="input-base pl-10 py-4"
                    placeholder={t('referenceOptional')}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => setMode('options')} className="flex-1 py-4 rounded-2xl">
                {t('back')}
              </Button>
              <Button type="submit" loading={loading} className="flex-[2] py-4 rounded-2xl" leftIcon={<CheckCircle2 size={18} />}>
                {mode === 'pagado' ? t('confirmBtn') : t('savePayment')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
