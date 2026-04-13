'use client'

import { CalendarDays, Plus, ChevronLeft, ChevronRight, Search, Clock, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'
import { useAppointmentsList } from './hooks/use-appointments-list'
import { formatTime, formatCurrency } from '@/lib/utils'
import { getServiceNames, getPrimaryColor, getTotalDuration, getTotalPrice } from '@/lib/utils/appointment-services'
import type { AppointmentStatus } from '@/types'
import { useTranslations } from 'next-intl'

export default function AppointmentsPage() {
  const t = useTranslations('appointments')
  const {
    filteredApts,
    loading,
    resolvingId,
    view,
    setView,
    date,
    setDate,
    query,
    setQuery,
    handlePrevDay,
    handleNextDay,
    handleResolve,
    isExpired,
  } = useAppointmentsList()

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <Link href="/dashboard/appointments/new" className="flex-shrink-0">
          <Button leftIcon={<Plus size={16} />}>{t('newAppointment')}</Button>
        </Link>
      </div>

      <div className="flex flex-col gap-3 bg-surface p-2 rounded-2xl border border-border">
        <div className="flex items-center gap-1">
          <button onClick={handlePrevDay} className="btn-ghost p-2 rounded-xl flex-shrink-0">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 text-center font-medium text-foreground text-sm capitalize">
            {date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <button onClick={handleNextDay} className="btn-ghost p-2 rounded-xl flex-shrink-0">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder={t('searchApt')}
              value={query} onChange={e => setQuery(e.target.value)}
              className="input-base pl-9 h-9 text-sm w-full" />
          </div>
          <div className="flex bg-muted p-1 rounded-xl flex-shrink-0">
            {(['day', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  view === v
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}>
                {v === 'day' ? t('day') : t('week')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card className="p-0 overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex flex-col justify-center items-center h-[400px] text-muted-foreground">
            <Loader2 size={32} className="animate-spin mb-4" style={{ color: '#0062FF' }} />
            <p>{t('loadingAgenda')}</p>
          </div>
        ) : filteredApts.length === 0 ? (
          <div className="text-center py-20">
            <CalendarDays size={48} className="text-muted-foreground mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium text-foreground">{t('noAptsTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('noAptsDesc')}</p>
            <Link href="/dashboard/appointments/new">
              <Button variant="secondary" className="mt-4">{t('scheduleApt')}</Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredApts.map(apt => {
              const expired = isExpired(apt)
              return (
                <div key={apt.id}>
                  {/* Main appointment row */}
                  <div className={`flex items-start sm:items-center gap-4 p-4 transition-colors group ${
                    expired ? 'bg-yellow-500/5' : 'hover:bg-surface'
                  }`}>
                    <div className="text-center w-14 flex-shrink-0 pt-1 sm:pt-0">
                      <p className="text-sm font-bold text-foreground">{formatTime(apt.start_at)}</p>
                      <p className="text-xs text-muted-foreground">{formatTime(apt.end_at)}</p>
                    </div>
                    <div className="w-1 h-12 sm:h-10 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getPrimaryColor(apt) }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-foreground group-hover:text-brand-600 transition-colors">
                          {apt.client?.name ?? t('unknownClient')}
                        </p>
                        {apt.is_dual_booking && <DualBookingBadge />}
                        {/* Expired indicator */}
                        {expired && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(255,214,10,0.12)', color: '#FFD60A', border: '1px solid rgba(255,214,10,0.25)' }}>
                            <AlertCircle size={10} /> {t('unmanaged')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span>{getServiceNames(apt)} ({getTotalDuration(apt)} min)</span>
                        <span className="hidden sm:inline">·</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {apt.assigned_user?.name ?? t('unassigned')}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <AppointmentStatusBadge status={(apt.status ?? 'pending') as AppointmentStatus} />
                      <p className="text-xs font-semibold text-foreground">
                        {formatCurrency(getTotalPrice(apt))}
                      </p>
                      <Link href={`/dashboard/appointments/${apt.id}/edit`}
                        className="text-[11px] font-medium hover:underline"
                        style={{ color: '#3884FF' }}>
                        {t('edit')}
                      </Link>
                    </div>
                  </div>

                  {/* Expired resolution bar */}
                  {expired && (
                    <div className="flex items-center gap-3 px-4 py-3 flex-wrap"
                      style={{ background: 'rgba(255,214,10,0.06)', borderTop: '1px solid rgba(255,214,10,0.15)' }}>
                      <p className="text-xs font-medium flex-1" style={{ color: '#FFD60A' }}>
                        {t('pastAptCheck')}
                      </p>
                      <div className="flex gap-2 flex-shrink-0 flex-wrap">
                        <button
                          onClick={() => handleResolve(apt.id, 'completed')}
                          disabled={resolvingId === apt.id}
                          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
                          style={{ background: 'rgba(48,209,88,0.12)', color: '#30D158', border: '1px solid rgba(48,209,88,0.25)' }}>
                          {resolvingId === apt.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <CheckCircle2 size={13} />
                          }
                          {t('yesAttended')}
                        </button>
                        <button
                          onClick={() => handleResolve(apt.id, 'no_show')}
                          disabled={resolvingId === apt.id}
                          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
                          style={{ background: 'rgba(255,59,48,0.08)', color: '#FF3B30', border: '1px solid rgba(255,59,48,0.2)' }}>
                          {resolvingId === apt.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <XCircle size={13} />
                          }
                          {t('noShow')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}