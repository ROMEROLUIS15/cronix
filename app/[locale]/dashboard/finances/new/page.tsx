'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, DollarSign, Loader2, User } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ClientSelect } from '@/components/ui/client-select'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as clientsRepo from '@/lib/repositories/clients.repo'
import type { PaymentMethod, Client } from '@/types'
import { useTranslations } from 'next-intl'

export default function NewFinancePage() {
  const router = useRouter()
  const t = useTranslations('finances.cobro')
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()

  const [form, setForm] = useState({
    client_id: '',
    amount:    '',
    method:    'cash' as PaymentMethod,
    notes:     '',
    date:      new Date().toISOString().split('T')[0] as string,
  })
  
  const [clients, setClients] = useState<Client[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    clientsRepo.getClients(supabase, businessId).then(data => {
      setClients(data as Client[])
      setLoadingData(false)
    })
  }, [supabase, businessId, contextLoading])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId || !form.client_id) {
      setMsg({ type: 'error', text: t('errorClient') })
      return
    }
    setSaving(true)

    const amount = parseFloat(form.amount)

    const { error } = await supabase.from('transactions').insert({
      business_id: businessId,
      client_id:   form.client_id,
      amount,
      net_amount:  amount, // sin descuento ni propina por defecto
      method:      form.method,
      notes:       form.notes.trim() || null,
      paid_at: form.date ? new Date(form.date).toISOString() : null,
    })

    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: t('errorSave') })
    } else {
      router.push('/dashboard/finances')
      router.refresh()
    }
  }

  if (loadingData) {
    return (
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">{t('loading')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard" className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground mr-4">
        <ArrowLeft size={16} /> {t('back')}
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-emerald-400">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      {msg && (
        <div className="p-4 rounded-xl text-sm font-semibold" style={{ background: msg.type === 'error' ? 'rgba(255,59,48,0.1)' : 'rgba(48,209,88,0.1)', color: msg.type === 'error' ? '#FF3B30' : '#30D158' }}>
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-emerald-900/30 flex items-center justify-center border border-emerald-500/20">
              <User size={18} className="text-emerald-500" />
            </div>
            <h2 className="text-base font-semibold text-foreground">{t('paymentAssign')}</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="client">
                {t('searchClient')}
              </label>
              <ClientSelect
                clients={clients}
                value={form.client_id}
                onChange={val => setForm(f => ({ ...f, client_id: val }))}
                required
              />
              <p className="text-xs text-muted-foreground mt-2 mt-1">
                {t('clientHelp')}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-emerald-900/30 flex items-center justify-center border border-emerald-500/20">
              <DollarSign size={18} className="text-emerald-500" />
            </div>
            <h2 className="text-base font-semibold text-foreground">{t('detailsTitle')}</h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="amount">
                  {t('amount')}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <input
                    id="amount" type="number" required min="1" step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="input-base pl-8 border-emerald-500/30 focus:border-emerald-500 focus:ring-emerald-500/20" placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="method">
                  {t('method')}
                </label>
                <select id="method" required value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
                  className="input-base bg-card"
                >
                  <option value="cash">{t('methods.cash')}</option>
                  <option value="transfer">{t('methods.transfer')}</option>
                  <option value="card">{t('methods.card')}</option>
                  <option value="qr">{t('methods.qr')}</option>
                  <option value="other">{t('methods.other')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="date">
                  {t('date')}
                </label>
                <input id="date" type="date" required value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="input-base"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="notes">
                  {t('notes')}
                </label>
                <input id="notes" type="text" value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="input-base"
                  placeholder={t('notesPlaceholder')}
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 pt-4 pb-10">
          <Link href="/dashboard">
            <Button variant="secondary" type="button">{t('cancel')}</Button>
          </Link>
          <Button type="submit" loading={saving} leftIcon={<DollarSign size={16} />} style={{ backgroundColor: '#30D158', color: '#000' }}>
            {t('save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
