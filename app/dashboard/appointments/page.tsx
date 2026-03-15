'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarDays, Plus, ChevronLeft, ChevronRight, Search, Clock, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'
import { formatTime, formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { Appointment } from '@/types'
import { format } from 'date-fns'

export default function AppointmentsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'day' | 'week'>('day')
  const [date, setDate] = useState(new Date())
  const [query, setQuery] = useState('')
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: dbUser } = await supabase
        .from('users').select('business_id').eq('id', user.id).single()
      if (dbUser?.business_id) setBusinessId(dbUser.business_id)
      else setLoading(false)
    }
    init()
  }, [])

  const fetchAppointments = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    const startOfDay = format(date, 'yyyy-MM-dd')
    const endOfDay = format(new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1), 'yyyy-MM-dd HH:mm:ss')

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, start_at, end_at, status, is_dual_booking, notes,
        client:clients(id, name, phone, avatar_url),
        service:services(id, name, color, duration_min, price),
        assigned_user:users(id, name, avatar_url, color)
      `)
      .eq('business_id', businessId)
      .gte('start_at', startOfDay)
      .lt('start_at', endOfDay)
      .order('start_at', { ascending: true })

    if (!error && data) setAppointments(data as Appointment[])
    setLoading(false)
  }, [businessId, date])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])

  if (loading && !businessId) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="animate-spin" /></div>
  }

  if (!businessId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">No autorizado. Por favor inicia sesión.</p>
      </div>
    )
  }

  const filteredApts = appointments.filter(
    (a) =>
      (a.client as any)?.name?.toLowerCase().includes(query.toLowerCase()) ||
      (a.service as any)?.name?.toLowerCase().includes(query.toLowerCase())
  )

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
        {/* Date navigator */}
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
        {/* Search + view toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text" placeholder="Buscar cita..."
              value={query} onChange={(e) => setQuery(e.target.value)}
              className="input-base pl-9 h-9 text-sm w-full"
            />
          </div>
          <div className="flex bg-muted p-1 rounded-xl flex-shrink-0">
            {(['day', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
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
            <Loader2 size={32} className="animate-spin mb-4" />
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
            {filteredApts.map((apt) => (
              <div key={apt.id} className="flex items-start sm:items-center gap-4 p-4 hover:bg-surface transition-colors group">
                <div className="text-center w-14 flex-shrink-0 pt-1 sm:pt-0">
                  <p className="text-sm font-bold text-foreground">{formatTime(apt.start_at)}</p>
                  <p className="text-xs text-muted-foreground">{formatTime(apt.end_at)}</p>
                </div>
                <div className="w-1 h-12 sm:h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: (apt.service as any)?.color ?? '#ccc' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-foreground group-hover:text-brand-600 transition-colors">
                      {(apt.client as any)?.name ?? 'Cliente desconocido'}
                    </p>
                    {apt.is_dual_booking && <DualBookingBadge />}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span>{(apt.service as any)?.name} ({(apt.service as any)?.duration_min} min)</span>
                    <span className="hidden sm:inline">·</span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {(apt.assigned_user as any)?.name ?? 'Sin asignar'}
                    </span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <AppointmentStatusBadge status={(apt.status ?? 'pending') as any} />
                  <p className="text-xs font-semibold text-foreground">
                    {formatCurrency((apt.service as any)?.price ?? 0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}