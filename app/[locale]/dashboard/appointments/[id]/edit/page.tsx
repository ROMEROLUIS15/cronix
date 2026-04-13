'use client'

import {
  ArrowLeft, CalendarDays, AlertTriangle, Info,
  Loader2, CheckCircle2, AlertCircle, Save, Ban, Bell, BellOff,
} from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DualBookingBadge } from '@/components/ui/badge'
import { ClientSelect } from '@/components/ui/client-select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { useTranslations } from 'next-intl'
import { useEditAppointmentForm } from './hooks/use-edit-appointment-form'

function fmtReminder(mins: number) {
  if (mins >= 1440) return `${mins / 1440} día${mins >= 2880 ? 's' : ''}`
  if (mins >= 60)   return `${mins / 60} hora${mins >= 120 ? 's' : ''}`
  return `${mins} min`
}

export default function EditAppointmentPage() {
  const t      = useTranslations('appointments.form')
  const statusT = useTranslations('dashboard')

  const {
    clients, services, users, loadingData,
    form, setForm,
    selectedServices, totalDuration, totalPrice,
    validation, setConfirmed,
    bizNotif, skipReminder, setSkipReminder,
    saving, msg, handleSubmit,
  } = useEditAppointmentForm()

  if (loadingData) {
    return (
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">{t('loadingApt')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/appointments"
        className="btn-ghost inline-flex text-sm gap-2" style={{ color: '#909098' }}>
        <ArrowLeft size={16} /> {t('backToAgenda')}
      </Link>

      <div>
        <h1 className="text-2xl font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.025em' }}>
          {t('editAptTitle')}
        </h1>
        <p className="text-sm" style={{ color: '#909098' }}>{t('editAptSubtitle')}</p>
      </div>

      {msg && (
        <div className="p-4 rounded-xl flex items-center gap-3 text-sm"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.08)',  border: '1px solid rgba(48,209,88,0.2)',  color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)',  border: '1px solid rgba(255,59,48,0.2)',  color: '#FF3B30' }}>
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,98,255,0.1)' }}>
              <CalendarDays size={18} style={{ color: '#0062FF' }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>
              {t('infoTitle')}
            </h2>
          </div>

          <div className="space-y-4">
            {/* Client */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('client')} <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <ClientSelect
                clients={clients}
                value={form.client_id}
                onChange={val => setForm(f => ({ ...f, client_id: val }))}
                required
              />
            </div>

            {/* Date/time */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('dateTime')} <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <DateTimePicker
                value={form.start_at}
                onChange={v => setForm(f => ({ ...f, start_at: v }))}
                required
              />
            </div>

            {/* Slot overlap error */}
            {validation.slotError && (
              <div className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)' }}>
                <Ban size={18} style={{ color: '#FF3B30', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#FF3B30' }}>{t('slotErrors.title')}</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,59,48,0.75)' }}>{validation.slotError}</p>
                </div>
              </div>
            )}

            {/* Double booking warn */}
            {!validation.slotError && validation.doubleBookingLevel === 'warn' && (
              <div className="flex flex-col sm:flex-row items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,214,10,0.06)', border: '1px solid rgba(255,214,10,0.25)' }}>
                <AlertTriangle size={18} style={{ color: '#FFD60A', flexShrink: 0, marginTop: 2 }} />
                <div className="flex-1">
                  <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#FFD60A' }}>
                    {t('slotErrors.doubleTitle')} <DualBookingBadge />
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,214,10,0.7)' }}>{validation.doubleBookingMsg}</p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" checked={validation.confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded" style={{ accentColor: '#FFD60A' }} />
                    <span className="text-xs font-medium" style={{ color: '#FFD60A' }}>
                      {t('slotErrors.confirmDoubleKeep')}
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Servicios (multi-select) */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('services')} <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <div className="space-y-2">
                {services.map(s => {
                  const isSelected = form.service_ids.includes(s.id)
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                      style={{
                        background: isSelected ? 'rgba(0,98,255,0.08)' : '#212125',
                        border: isSelected ? '1px solid rgba(0,98,255,0.35)' : '1px solid #2E2E33',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setForm(f => ({
                            ...f,
                            service_ids: isSelected
                              ? f.service_ids.filter(id => id !== s.id)
                              : [...f.service_ids, s.id],
                          }))
                        }}
                        className="w-4 h-4 rounded flex-shrink-0"
                        style={{ accentColor: '#0062FF' }}
                      />
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color ?? '#ccc' }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium" style={{ color: isSelected ? '#F2F2F2' : '#909098' }}>
                          {s.name}
                        </span>
                      </div>
                      <span className="text-xs flex-shrink-0" style={{ color: '#606068' }}>
                        {s.duration_min} min · ${s.price.toLocaleString('es-CO')}
                      </span>
                    </label>
                  )
                })}
              </div>
              {selectedServices.length > 0 && (
                <p className="mt-2 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
                  <Info size={12} />
                  {t('total')}: {totalDuration} min · ${totalPrice.toLocaleString('es-CO')}
                  {selectedServices.length > 1 && ` · ${selectedServices.length} ${t('servicesCount')}`}
                </p>
              )}
            </div>

            {/* Staff */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('staff')}
              </label>
              <select value={form.assigned_user_id}
                onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                className="input-base">
                <option value="">{t('unassigned', { fallback: 'Sin asignar' })}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('status')}
              </label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="input-base">
                <option value="pending">{statusT('status.pending')}</option>
                <option value="confirmed">{statusT('status.confirmed')}</option>
                <option value="completed">{statusT('status.completed')}</option>
                <option value="cancelled">{statusT('status.cancelled')}</option>
                <option value="no_show">{statusT('status.noShow')}</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('notes')}
              </label>
              <textarea rows={3} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('notesPlaceholder')}
                className="input-base resize-none" />
            </div>

            {/* Recordatorio automatico */}
            {bizNotif.whatsapp ? (
              <div className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: '#212125', border: '1px solid #2E2E33' }}>
                <div className="flex items-center gap-2">
                  {skipReminder
                    ? <BellOff size={14} style={{ color: '#606068' }} />
                    : <Bell    size={14} style={{ color: '#0062FF' }} />
                  }
                  <span className="text-sm" style={{ color: skipReminder ? '#606068' : '#F2F2F2' }}>
                    {skipReminder
                      ? t('reminderNone')
                      : t('reminderWhatsapp')
                    }
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs" style={{ color: '#909098' }}>{t('skip')}</span>
                  <div className="relative">
                    <input type="checkbox" className="sr-only peer"
                      checked={skipReminder} onChange={e => setSkipReminder(e.target.checked)} />
                    <div className="w-8 h-4 rounded-full transition-colors"
                      style={{ background: skipReminder ? '#FF3B30' : '#3A3A3F' }} />
                    <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                  </div>
                </label>
              </div>
            ) : null}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 pb-10">
          <Link href="/dashboard/appointments">
            <Button variant="secondary" type="button">{t('cancel')}</Button>
          </Link>
          <Button type="submit" loading={saving}
            disabled={validation.validating || !!validation.slotError || validation.doubleBookingLevel === 'blocked' || (validation.doubleBookingLevel === 'warn' && !validation.confirmed)}
            leftIcon={<Save size={16} />}>
            {t('save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
