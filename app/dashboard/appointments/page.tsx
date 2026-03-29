'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight,
  Search, Clock, Loader2, CheckCircle2, XCircle, AlertCircle, MessageCircle,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as appointmentsRepo from '@/lib/repositories/appointments.repo'
import { isExpiredAppointment } from '@/lib/use-cases/appointments.use-case'
import { formatDate, formatTime, formatCurrency, appointmentStatusConfig } from '@/lib/utils'
import { getServiceNames, getPrimaryColor, getTotalDuration, getTotalPrice } from '@/lib/utils/appointment-services'
import type { AppointmentWithRelations, AppointmentStatus } from '@/types'
import { format } from 'date-fns'

export default function AppointmentsPage() {
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()
  const [appointments,  setAppointments]  = useState<AppointmentWithRelations[]>([])
  const [loading,       setLoading]       = useState(true)
  const [resolvingId,   setResolvingId]   = useState<string | null>(null)
  const [view,          setView]          = useState<'day' | 'week'>('day')
  const [date,          setDate]          = useState(new Date())
  const [query,         setQuery]         = useState('')

  const fetchAppointments = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    const dateStr    = format(date, 'yyyy-MM-dd')
    const startOfDay = new Date(`${dateStr}T00:00:00`).toISOString()
    const endOfDay   = new Date(`${dateStr}T23:59:59.999`).toISOString()

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, start_at, end_at, status, is_dual_booking, notes,
        client:clients(id, name, phone, avatar_url),
        service:services(id, name, color, duration_min, price),
        appointment_services(sort_order, service:services(id, name, color, duration_min, price)),
        assigned_user:users(id, name, avatar_url, color)
      `)
      .eq('business_id', businessId)
      .gte('start_at', startOfDay)
      .lt('start_at', endOfDay)
      .order('start_at', { ascending: true })

    if (!error && data) setAppointments(data as AppointmentWithRelations[])
    setLoading(false)
  }, [businessId, date, supabase])

  useEffect(() => {
    if (!contextLoading) {
      fetchAppointments()
    }
  }, [fetchAppointments, contextLoading])

  const filteredApts = useMemo(
    () => appointments.filter(a =>
      a.client?.name?.toLowerCase().includes(query.toLowerCase()) ||
      a.service?.name?.toLowerCase().includes(query.toLowerCase())
    ),
    [appointments, query]
  )

  // ── Resolve expired appointment ────────────────────────────────────────
  const handleResolve = async (
    aptId: string,
    resolution: 'completed' | 'no_show'
  ) => {
    setResolvingId(aptId)
    await appointmentsRepo.updateAppointmentStatus(supabase, aptId, resolution)
    setAppointments(prev =>
      prev.map(a => a.id === aptId ? { ...a, status: resolution } : a)
    )
    setResolvingId(null)
  }

  // ── Approve / Reject WhatsApp pending appointment ─────────────────────
  const handleWhatsAppReview = async (
    aptId: string,
    action: 'confirmed' | 'cancelled'
  ) => {
    setResolvingId(aptId)
    await appointmentsRepo.updateAppointmentStatus(supabase, aptId, action)
    setAppointments(prev =>
      prev.map(a => a.id === aptId ? { ...a, status: action } : a)
    )
    setResolvingId(null)
  }

  if (loading || contextLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin" style={{ color: '#0062FF' }} />
      </div>
    )
  }

  const handlePrevDay = () => setDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n })
  const handleNextDay = () => setDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Agenda</h1>
          <p className="text-muted-foreground text-sm">Gestiona tus citas y disponibilidad</p>
        </div>
        <Link href="/dashboard/appointments/new" className="flex-shrink-0">
          <Button leftIcon={<Plus size={16} />}>Nueva Cita</Button>
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
            <input type="text" placeholder="Buscar cita..."
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
                {v === 'day' ? 'Día' : 'Semana'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card className="p-0 overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex flex-col justify-center items-center h-[400px] text-muted-foreground">
            <Loader2 size={32} className="animate-spin mb-4" style={{ color: '#0062FF' }} />
            <p>Cargando agenda...</p>
          </div>
        ) : filteredApts.length === 0 ? (
          <div className="text-center py-20">
            <CalendarDays size={48} className="text-muted-foreground mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium text-foreground">No hay citas registradas</p>
            <p className="text-sm text-muted-foreground mt-1">Para el día seleccionado no hay actividad.</p>
            <Link href="/dashboard/appointments/new">
              <Button variant="secondary" className="mt-4">Agendar Cita</Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredApts.map(apt => {
              const expired = isExpiredAppointment({
                end_at: apt.end_at,
                status: apt.status ?? 'pending',
              })
              const isWhatsAppPending = apt.status === 'pending' && apt.notes === 'Agendado vía WhatsApp AI'

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
                          {apt.client?.name ?? 'Cliente desconocido'}
                        </p>
                        {apt.is_dual_booking && <DualBookingBadge />}
                        {/* Expired indicator */}
                        {expired && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(255,214,10,0.12)', color: '#FFD60A', border: '1px solid rgba(255,214,10,0.25)' }}>
                            <AlertCircle size={10} /> Sin gestionar
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span>{getServiceNames(apt)} ({getTotalDuration(apt)} min)</span>
                        <span className="hidden sm:inline">·</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {apt.assigned_user?.name ?? 'Sin asignar'}
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
                        Editar
                      </Link>
                    </div>
                  </div>

                  {/* WhatsApp pending approval bar */}
                  {isWhatsAppPending && !expired && (
                    <div className="flex items-center gap-3 px-4 py-3 flex-wrap"
                      style={{ background: 'rgba(37,211,102,0.06)', borderTop: '1px solid rgba(37,211,102,0.15)' }}>
                      <div className="flex items-center gap-2 flex-1">
                        <MessageCircle size={14} style={{ color: '#25D366', flexShrink: 0 }} />
                        <p className="text-xs font-medium" style={{ color: '#25D366' }}>
                          Solicitud vía WhatsApp — pendiente de aprobación
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0 flex-wrap">
                        <button
                          onClick={() => handleWhatsAppReview(apt.id, 'confirmed')}
                          disabled={resolvingId === apt.id}
                          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
                          style={{ background: 'rgba(48,209,88,0.12)', color: '#30D158', border: '1px solid rgba(48,209,88,0.25)' }}>
                          {resolvingId === apt.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <CheckCircle2 size={13} />
                          }
                          Confirmar
                        </button>
                        <button
                          onClick={() => handleWhatsAppReview(apt.id, 'cancelled')}
                          disabled={resolvingId === apt.id}
                          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
                          style={{ background: 'rgba(255,59,48,0.08)', color: '#FF3B30', border: '1px solid rgba(255,59,48,0.2)' }}>
                          {resolvingId === apt.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <XCircle size={13} />
                          }
                          Rechazar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expired resolution bar */}
                  {expired && (
                    <div className="flex items-center gap-3 px-4 py-3 flex-wrap"
                      style={{ background: 'rgba(255,214,10,0.06)', borderTop: '1px solid rgba(255,214,10,0.15)' }}>
                      <p className="text-xs font-medium flex-1" style={{ color: '#FFD60A' }}>
                        Esta cita ya pasó. ¿Fue atendido el cliente?
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
                          Sí, fue atendido
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
                          No se presentó
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