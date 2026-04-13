'use client'

import { Suspense } from 'react'
import {
  ArrowLeft, CalendarDays, AlertTriangle, Info,
  Loader2, CheckCircle2, AlertCircle, UserPlus, Ban, Bell, BellOff,
  Mic, MicOff
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DualBookingBadge } from '@/components/ui/badge'
import { ClientSelect } from '@/components/ui/client-select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { useTranslations } from 'next-intl'
import { useAppointmentForm } from './hooks/use-appointment-form'

function fmtReminder(mins: number) {
  if (mins >= 1440) return `${mins / 1440} día${mins >= 2880 ? 's' : ''}`
  if (mins >= 60)   return `${mins / 60} hora${mins >= 120 ? 's' : ''}`
  return `${mins} min`
}

// ── Inner form component ───────────────────────────────────────────────────
function NewAppointmentForm() {
  const router = useRouter()
  const t      = useTranslations('appointments.form')
  const statusT = useTranslations('dashboard')

  const {
    clients, services, users, loadingData, fetchError,
    form, setForm,
    selectedServices, totalDuration, totalPrice, preselectedDate,
    validation, setConfirmed, canSubmit,
    bizNotif, skipReminder, setSkipReminder,
    saving, msg, handleSubmit,
    isListening, aiParsing, handleVoiceAssistant,
  } = useAppointmentForm()

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-fade-in">
        <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)' }}>
          <AlertCircle size={32} style={{ color: '#FF3B30' }} />
        </div>
        <h2 className="text-xl font-bold mb-2 text-white">{t('connError.title', { fallback: 'Error de conexión' })}</h2>
        <p className="text-sm mb-6 max-w-xs" style={{ color: '#909098' }}>{fetchError}</p>
        <Button onClick={() => window.location.reload()} variant="secondary">
          {t('connError.retry')}
        </Button>
      </div>
    )
  }

  if (loadingData) {
    return (
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">{t('loadingForm')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">

      {/* Mobile nav — solid blue buttons */}
      <div className="flex sm:hidden items-center gap-3">
        <Link href="/dashboard/appointments"
          className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl"
          style={{ background: '#0062FF', color: '#fff', border: '1px solid #0062FF' }}>
          <ArrowLeft size={16} /> {t('backToAgenda')}
        </Link>
        <Link href="/dashboard/clients/new"
          className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl"
          style={{ background: '#0062FF', color: '#fff', border: '1px solid #0062FF' }}>
          <UserPlus size={15} /> Nuevo Cliente
        </Link>
      </div>

      {/* Desktop nav — text links */}
      <div className="hidden sm:flex items-center justify-between gap-3">
        <Link href="/dashboard/appointments"
          className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-80 transition-opacity"
          style={{ color: '#3884FF' }}>
          <ArrowLeft size={16} /> {t('backToAgenda')}
        </Link>
        <Link href="/dashboard/clients/new"
          className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-xl hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(0,98,255,0.1)', color: '#3884FF', border: '1px solid rgba(0,98,255,0.2)' }}>
          <UserPlus size={15} /> Nuevo Cliente
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F2F2F2' }}>{t('newAptTitle')}</h1>
          <p className="text-sm" style={{ color: '#909098' }}>{t('newAptSubtitle')}</p>
        </div>

        <Button
          type="button"
          onClick={handleVoiceAssistant}
          disabled={aiParsing}
          variant="secondary"
          className={`h-11 w-11 p-0 rounded-full flex items-center justify-center transition-all ${isListening ? 'animate-pulse bg-red-500/20 border-red-500/50 text-red-500' : ''}`}
          title="Asistente de Voz AI"
        >
          {aiParsing ? (
            <Loader2 className="animate-spin text-brand-500" size={20} />
          ) : isListening ? (
            <MicOff size={20} />
          ) : (
            <Mic size={20} />
          )}
        </Button>
      </div>

      {msg && (
        <div className="flex items-center gap-3 text-sm p-4 rounded-xl"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.1)',  border: '1px solid rgba(48,209,88,0.2)',  color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)',  color: '#FF6B6B' }}>
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <h2 className="text-base font-semibold mb-4" style={{ color: '#F2F2F2' }}>
            {t('infoTitle')}
          </h2>
          <div className="space-y-4">

            {/* Cliente */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('client')} *
              </label>
              <ClientSelect
                clients={clients}
                value={form.client_id}
                onChange={val => setForm(f => ({ ...f, client_id: val }))}
                required
              />
            </div>

            {/* Fecha y hora — dos modos */}
            <div className="space-y-3">
              {preselectedDate ? (
                <>
                  {/* Fecha bloqueada en azul — viene del calendario */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                      {t('date')}
                    </label>
                    <div
                      className="input-base flex items-center gap-2"
                      style={{
                        background:  'rgba(0,98,255,0.08)',
                        border:      '1px solid rgba(0,98,255,0.35)',
                        color:       '#3884FF',
                        cursor:      'default',
                        userSelect:  'none',
                      }}
                    >
                      <CalendarDays size={15} style={{ flexShrink: 0 }} />
                      <span className="font-semibold">
                        {new Date(`${preselectedDate}T00:00`).toLocaleDateString('es-CO', {
                          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Solo hora editable */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                      {t('time')} *
                    </label>
                    <input
                      type="time"
                      required
                      value={form.start_at.split('T')[1] ?? ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        start_at: `${preselectedDate}T${e.target.value}`,
                      }))}
                      className="input-base"
                    />
                  </div>
                </>
              ) : (
                /* Flujo normal — fecha + hora juntos */
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                    {t('dateTime')} *
                  </label>
                  <DateTimePicker
                    value={form.start_at}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={v => setForm(f => ({ ...f, start_at: v }))}
                    required
                  />
                </div>
              )}
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
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,214,10,0.75)' }}>{validation.doubleBookingMsg}</p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" checked={validation.confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded" style={{ accentColor: '#FFD60A' }} />
                    <span className="text-xs font-medium" style={{ color: '#FFD60A' }}>
                      {t('slotErrors.confirmDoubleCheck')}
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Servicios (multi-select) */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('services')} *
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
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/services')}
                  className="w-full text-left p-3 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ background: '#212125', border: '1px solid #2E2E33', color: '#3884FF' }}
                >
                  {t('addService')}
                </button>
              </div>
              {selectedServices.length > 0 && (
                <p className="mt-2 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
                  <Info size={12} />
                  {t('total')}: {totalDuration} min · ${totalPrice.toLocaleString('es-CO')}
                  {selectedServices.length > 1 && ` · ${selectedServices.length} ${t('servicesCount')}`}
                </p>
              )}
            </div>

            {/* Empleado */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('staff')}
              </label>
              <select value={form.assigned_user_id}
                onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                className="input-base bg-card">
                <option value="">{t('unassigned', { fallback: 'Sin asignar' })}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Notas */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('notes')}
              </label>
              <textarea rows={3} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('notesPlaceholder')}
                className="input-base resize-none" />
            </div>

            {/* Recordatorio automático */}
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
          <Button type="submit" loading={saving} disabled={!canSubmit}
            leftIcon={<CalendarDays size={16} />}>
            {t('scheduleBtn')}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ── Page export — Suspense required for useSearchParams ───────────────────
export default function NewAppointmentPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">Cargando...</span>
      </div>
    }>
      <NewAppointmentForm />
    </Suspense>
  )
}
