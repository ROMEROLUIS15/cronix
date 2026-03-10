'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronLeft, ChevronRight, CalendarDays, BarChart3, Users, DollarSign, TrendingUp, ArrowRight, X, Check, Ban, Pencil, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatTime } from '@/lib/utils'
import { ServicesOnboardingBanner } from '@/components/dashboard/services-onboarding-banner'
import { AppointmentStatusBadge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AppointmentStatus } from '@/types'

const HOURS: number[] = Array.from({ length: 14 }, (_, i) => i + 7) // 7am – 8pm

type Apt = {
  id: string
  start_at: string
  end_at: string
  status: string
  is_dual_booking: boolean
  notes: string | null
  client: { id: string; name: string; phone: string | null; avatar_url: string | null } | null
  service: { id: string; name: string; color: string | null; duration_min: number; price: number } | null
  assigned_user: { id: string; name: string } | null
}

export default function DashboardPage() {
  const supabase = createClient()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [userName, setUserName] = useState('Usuario')
  const [tab, setTab] = useState<'agenda' | 'resumen'>('agenda')
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [appointments, setAppointments] = useState<Apt[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedApt, setSelectedApt] = useState<Apt | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [stats, setStats] = useState({ todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 })

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: dbUser } = await supabase
        .from('users').select('business_id, name').eq('id', user.id).single()
      if (dbUser?.business_id) {
        setBusinessId(dbUser.business_id)
        setUserName(dbUser.name?.split(' ')[0] || 'Usuario')
      } else {
        setLoading(false)
      }
    }
    init()
  }, [])

  const fetchAppointments = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    const date = selectedDate
    let from: string
    let to: string
    if (viewMode === 'day') {
      from = format(date, 'yyyy-MM-dd') + 'T00:00:00'
      to   = format(date, 'yyyy-MM-dd') + 'T23:59:59'
    } else {
      const weekStart = startOfWeek(date, { weekStartsOn: 1 })
      from = format(weekStart,           'yyyy-MM-dd') + 'T00:00:00'
      to   = format(addDays(weekStart, 6), 'yyyy-MM-dd') + 'T23:59:59'
    }
    const { data } = await supabase
      .from('appointments')
      .select(`id, start_at, end_at, status, is_dual_booking, notes,
        client:clients(id, name, phone, avatar_url),
        service:services(id, name, color, duration_min, price),
        assigned_user:users(id, name)`)
      .eq('business_id', businessId)
      .gte('start_at', from)
      .lte('start_at', to)
      .not('status', 'in', '("cancelled")')
      .order('start_at')
    setAppointments((data as Apt[]) ?? [])
    setLoading(false)
  }, [businessId, selectedDate, viewMode])

  const fetchStats = useCallback(async () => {
    if (!businessId) return
    const todayStr   = format(new Date(), 'yyyy-MM-dd')
    const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
    const [a, b, c, d] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('start_at', `${todayStr}T00:00:00`).lte('start_at', `${todayStr}T23:59:59`),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('business_id', businessId).is('deleted_at', null),
      supabase.from('transactions').select('net_amount').eq('business_id', businessId).gte('paid_at', `${monthStart}T00:00:00`),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('status', 'pending'),
    ])
    setStats({
      todayCount:   a.count ?? 0,
      totalClients: b.count ?? 0,
      monthRevenue: (c.data ?? []).reduce((s: number, t: any) => s + (t.net_amount ?? 0), 0),
      pending:      d.count ?? 0,
    })
  }, [businessId])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])
  useEffect(() => { fetchStats() }, [fetchStats])

  const openPanel  = (apt: Apt) => { setSelectedApt(apt); setPanelOpen(true) }
  const closePanel = () => { setPanelOpen(false); setTimeout(() => setSelectedApt(null), 300) }

  const updateStatus = async (status: AppointmentStatus) => {
    if (!selectedApt || !businessId) return
    setUpdatingStatus(true)
    await supabase.from('appointments').update({ status }).eq('id', selectedApt.id)
    setUpdatingStatus(false)
    setSelectedApt(prev => prev ? { ...prev, status } : null)
    fetchAppointments()
    fetchStats()
  }

  const navigate = (dir: 1 | -1) => {
    setSelectedDate(d => addDays(d, viewMode === 'day' ? dir : dir * 7))
  }

  const getAptStyle = (apt: Apt): { top: number; height: number } => {
    const start    = parseISO(apt.start_at)
    const end      = parseISO(apt.end_at)
    const startMin = start.getHours() * 60 + start.getMinutes()
    const endMin   = end.getHours()   * 60 + end.getMinutes()
    return {
      top:    ((startMin - 7 * 60) / 60) * 64,
      height: Math.max(((endMin - startMin) / 60) * 64, 32),
    }
  }

  // Typed as Date[] so TypeScript knows every element is a Date
  const weekDays: Date[] = Array.from(
    { length: 7 },
    (_, i) => addDays(startOfWeek(selectedDate, { weekStartsOn: 1 }), i)
  )

  const dateLabel =
    viewMode === 'day'
      ? format(selectedDate, "EEEE d 'de' MMMM", { locale: es })
      : `${format(weekDays[0] as Date, 'd MMM', { locale: es })} – ${format(weekDays[6] as Date, 'd MMM yyyy', { locale: es })}`

  // No business yet
  if (!loading && !businessId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md p-8 card-base">
          <div className="h-16 w-16 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users size={32} />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">¡Bienvenido a Agendo!</h2>
          <p className="text-muted-foreground mb-6">Para comenzar necesitas configurar tu negocio. Solo toma un minuto.</p>
          <Link href="/dashboard/setup" className="w-full block">
            <Button className="w-full">Configurar mi negocio</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full relative">
      {/* ── Main content ── */}
      <div className={`flex-1 min-w-0 space-y-5 animate-fade-in transition-all duration-300 ${panelOpen ? 'lg:mr-80' : ''}`}>

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Buenos días, {userName} 👋</h1>
            <p className="text-muted-foreground text-sm capitalize">{dateLabel}</p>
          </div>
          <Link href="/dashboard/appointments/new">
            <Button leftIcon={<Plus size={16} />}>Nueva Cita</Button>
          </Link>
        </div>

        <ServicesOnboardingBanner businessId={businessId ?? ''} />

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-muted p-1 rounded-xl w-fit">
          {(['agenda', 'resumen'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {t === 'agenda' ? <><CalendarDays size={15} /> Agenda</> : <><BarChart3 size={15} /> Resumen</>}
            </button>
          ))}
        </div>

        {/* ── AGENDA TAB ── */}
        {tab === 'agenda' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-3 bg-card border border-border rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => setSelectedDate(new Date())}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors">
                  Hoy
                </button>
                <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight size={18} />
                </button>
                <span className="text-sm font-semibold text-foreground capitalize ml-1">{dateLabel}</span>
              </div>
              <div className="flex bg-muted p-1 rounded-xl">
                {(['day', 'week'] as const).map(v => (
                  <button key={v} onClick={() => setViewMode(v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      viewMode === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}>
                    {v === 'day' ? 'Día' : 'Semana'}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar grid */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              {loading ? (
                <div className="flex justify-center items-center h-64">
                  <Loader2 size={28} className="animate-spin text-brand-600" />
                </div>
              ) : viewMode === 'day' ? (
                /* Day view */
                <div className="flex overflow-auto max-h-[600px]">
                  <div className="w-16 flex-shrink-0 border-r border-border">
                    {HOURS.map(h => (
                      <div key={h} className="h-16 flex items-start justify-end pr-3 pt-1">
                        <span className="text-[10px] text-muted-foreground font-medium">
                          {h.toString().padStart(2, '0')}:00
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 relative">
                    {HOURS.map(h => <div key={h} className="h-16 border-b border-border/40" />)}
                    {appointments.map(apt => {
                      const { top, height } = getAptStyle(apt)
                      return (
                        <button key={apt.id} onClick={() => openPanel(apt)}
                          className="absolute left-2 right-2 rounded-xl px-3 py-1.5 text-left shadow-sm hover:shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] overflow-hidden"
                          style={{ top, height, backgroundColor: apt.service?.color ?? '#6366f1', opacity: apt.status === 'completed' ? 0.6 : 1 }}>
                          <p className="text-white text-xs font-bold truncate">{apt.client?.name}</p>
                          <p className="text-white/80 text-[10px] truncate">{apt.service?.name}</p>
                        </button>
                      )
                    })}
                    {appointments.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <CalendarDays size={32} className="text-muted-foreground mx-auto mb-2 opacity-30" />
                          <p className="text-sm text-muted-foreground">Sin citas este día</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Week view */
                <div className="overflow-auto max-h-[600px]">
                  <div className="flex border-b border-border sticky top-0 bg-card z-10">
                    <div className="w-16 flex-shrink-0" />
                    {weekDays.map((day: Date) => (
                      <div key={day.toISOString()}
                        className={`flex-1 text-center py-3 border-l border-border ${isSameDay(day, new Date()) ? 'bg-brand-50' : ''}`}>
                        <p className="text-[10px] text-muted-foreground uppercase font-medium">
                          {format(day, 'EEE', { locale: es })}
                        </p>
                        <p className={`text-sm font-bold mt-0.5 ${isSameDay(day, new Date()) ? 'text-brand-600' : 'text-foreground'}`}>
                          {format(day, 'd')}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {appointments.filter(a => isSameDay(parseISO(a.start_at), day)).length} citas
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex">
                    <div className="w-16 flex-shrink-0 border-r border-border">
                      {HOURS.map(h => (
                        <div key={h} className="h-16 flex items-start justify-end pr-3 pt-1">
                          <span className="text-[10px] text-muted-foreground">{h.toString().padStart(2, '0')}:00</span>
                        </div>
                      ))}
                    </div>
                    {weekDays.map((day: Date) => {
                      const dayApts = appointments.filter(a => isSameDay(parseISO(a.start_at), day))
                      return (
                        <div key={day.toISOString()}
                          className={`flex-1 border-l border-border relative ${isSameDay(day, new Date()) ? 'bg-brand-50/30' : ''}`}>
                          {HOURS.map(h => <div key={h} className="h-16 border-b border-border/30" />)}
                          {dayApts.map(apt => {
                            const { top, height } = getAptStyle(apt)
                            return (
                              <button key={apt.id} onClick={() => openPanel(apt)}
                                className="absolute left-0.5 right-0.5 rounded-lg px-1.5 py-1 text-left hover:brightness-110 transition-all overflow-hidden"
                                style={{ top, height, backgroundColor: apt.service?.color ?? '#6366f1' }}>
                                <p className="text-white text-[10px] font-bold truncate leading-tight">{apt.client?.name}</p>
                                {height > 40 && <p className="text-white/70 text-[9px] truncate">{apt.service?.name}</p>}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── RESUMEN TAB ── */}
        {tab === 'resumen' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard title="Citas hoy" value={stats.todayCount} subtitle={`${stats.pending} pendientes`} icon={<CalendarDays size={22} />} accent />
              <StatCard title="Clientes totales" value={stats.totalClients} icon={<Users size={22} />} />
              <StatCard title="Ingresos del mes" value={formatCurrency(stats.monthRevenue)} icon={<DollarSign size={22} />} />
              <StatCard title="Por confirmar" value={stats.pending} subtitle="citas pendientes" icon={<TrendingUp size={22} />} />
            </div>
            <div className="card-base">
              <h2 className="text-base font-semibold text-foreground mb-4">Acciones rápidas</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { href: '/dashboard/appointments/new', label: 'Nueva cita',      icon: CalendarDays, primary: true },
                  { href: '/dashboard/clients/new',      label: 'Nuevo cliente',   icon: Users },
                  { href: '/dashboard/finances/new',     label: 'Registrar cobro', icon: DollarSign },
                ].map(action => {
                  const Icon = action.icon
                  return (
                    <Link key={action.href} href={action.href}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors text-sm font-medium ${
                        action.primary
                          ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700'
                          : 'bg-card text-foreground border-border hover:bg-surface'
                      }`}>
                      <Icon size={16} /> {action.label}
                      <ArrowRight size={14} className="ml-auto opacity-50" />
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Side Panel ── */}
      <div className={`fixed top-0 right-0 h-full w-80 bg-card border-l border-border shadow-2xl z-50 flex flex-col transition-transform duration-300 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedApt && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border"
              style={{ borderTopColor: selectedApt.service?.color ?? '#6366f1', borderTopWidth: 4 }}>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Detalle de cita</p>
                <p className="text-base font-bold text-foreground mt-0.5">{selectedApt.client?.name}</p>
              </div>
              <button onClick={closePanel} className="p-2 rounded-xl hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="flex items-center justify-between">
                <AppointmentStatusBadge status={selectedApt.status as AppointmentStatus} />
                <span className="text-sm font-bold text-foreground">{formatCurrency(selectedApt.service?.price ?? 0)}</span>
              </div>

              <div className="space-y-3">
                {[
                  { label: 'Servicio',  value: selectedApt.service?.name },
                  { label: 'Hora',      value: `${formatTime(selectedApt.start_at)} – ${formatTime(selectedApt.end_at)}` },
                  { label: 'Duración',  value: `${selectedApt.service?.duration_min} min` },
                  { label: 'Empleado',  value: selectedApt.assigned_user?.name ?? 'Sin asignar' },
                  { label: 'Teléfono', value: selectedApt.client?.phone ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    <span className="text-sm font-semibold text-foreground">{value}</span>
                  </div>
                ))}
                {selectedApt.notes && (
                  <div className="p-3 rounded-xl bg-surface border border-border">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Notas</p>
                    <p className="text-sm text-foreground">{selectedApt.notes}</p>
                  </div>
                )}
              </div>

              {selectedApt.status !== 'completed' && selectedApt.status !== 'cancelled' && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cambiar estado</p>
                  <div className="grid grid-cols-1 gap-2">
                    {selectedApt.status !== 'confirmed' && (
                      <button onClick={() => updateStatus('confirmed')} disabled={updatingStatus}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 transition-colors text-sm font-medium disabled:opacity-50">
                        <Check size={15} /> Confirmar cita
                      </button>
                    )}
                    <button onClick={() => updateStatus('completed')} disabled={updatingStatus}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 hover:bg-green-100 transition-colors text-sm font-medium disabled:opacity-50">
                      <Check size={15} /> Marcar completada
                    </button>
                    <button onClick={() => updateStatus('cancelled')} disabled={updatingStatus}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 transition-colors text-sm font-medium disabled:opacity-50">
                      <Ban size={15} /> Cancelar cita
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border">
              <Link href={`/dashboard/appointments/${selectedApt.id}/edit`}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors">
                <Pencil size={15} /> Editar cita completa
              </Link>
            </div>
          </>
        )}
      </div>

      {panelOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={closePanel} />
      )}
    </div>
  )
}