'use client'

import { useState, useEffect } from 'react'
import { CalendarDays, Plus, ChevronLeft, ChevronRight, Search, Clock, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'
import { formatTime, formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/get-session'
import type { Appointment } from '@/types'
import { format } from 'date-fns'

// Mock Tenant ID for Data Guard isolation until Auth is fully integrated
const TENANT_ID = '00000000-0000-0000-0000-000000000000'

export default function AppointmentsPage() {
  const [session, setSession] = useState<any>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'day' | 'week'>('day')
  const [date, setDate] = useState(new Date())
  const [query, setQuery] = useState('')
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      const sess = await getSession()
      setSession(sess)
      
      if (sess?.business_id) {
        const today = format(new Date(), 'yyyy-MM-dd')
        const { data } = await supabase
          .from('appointments')
          .select(`
            *,
            client:clients(id, name, phone, avatar_url),
            service:services(id, name, color, duration_min, price),
            assigned_user:users(id, name, avatar_url, color)
          `)
          .eq('business_id', sess.business_id)
          .gte('start_at', today)
          .order('start_at', { ascending: true })
        
        if (data) setAppointments(data as Appointment[])
      }
      setLoading(false)
    }
    init()
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]">Cargando...</div>
  }

  if (!session || !session.business_id) {
    return <div>No autorizado. Por favor inicie sesión.</div>
  }
  // Client-side fetching for date/view changes
  useEffect(() => {
    async function fetchAppointments() {
      setLoading(true)
      const startOfDay = format(date, 'yyyy-MM-dd')
      const endOfDay = format(new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1), 'yyyy-MM-dd HH:mm:ss') // End of day

      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          client:clients(id, name, phone, avatar_url),
          service:services(id, name, color, duration_min, price),
          assigned_user:users(id, name, avatar_url, color)
        `)
        .eq('business_id', session.business_id)
        .gte('start_at', startOfDay)
        .lt('start_at', endOfDay) // Fetch appointments for the selected day
        .order('start_at', { ascending: true })
        
      if (!error && data) {
        setAppointments(data as Appointment[])
      } else {
        console.error('Error fetching appointments:', error)
      }
      setLoading(false)
    }

    fetchAppointments()
  }, []) // Simplification: in real app, depend on date/view

  const filteredApts = appointments.filter(
    (a) => a.client?.name.toLowerCase().includes(query.toLowerCase()) || 
           a.service?.name.toLowerCase().includes(query.toLowerCase())
  )

  const handlePrevDay = () => setDate(d => new Date(d.setDate(d.getDate() - 1)))
  const handleNextDay = () => setDate(d => new Date(d.setDate(d.getDate() + 1)))

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agenda</h1>
          <p className="text-muted-foreground text-sm">Gestiona tus citas y disponibilidad</p>
        </div>
        <Link href="/dashboard/appointments/new">
          <Button leftIcon={<Plus size={16} />}>Nueva Cita</Button>
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-surface p-2 rounded-2xl border border-border">
        {/* Date navigation */}
        <div className="flex items-center gap-1 w-full sm:w-auto">
          <button onClick={handlePrevDay} className="btn-ghost p-2 rounded-xl">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 sm:w-48 text-center font-medium text-foreground text-sm">
            {date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <button onClick={handleNextDay} className="btn-ghost p-2 rounded-xl">
            <ChevronRight size={18} />
          </button>
        </div>

        {/* View toggles & Search */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar cita..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input-base pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex bg-muted p-1 rounded-xl">
            <button
              onClick={() => setView('day')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                view === 'day' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Día
            </button>
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                view === 'week' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Semana
            </button>
          </div>
        </div>
      </div>

      {/* Agenda list */}
      <Card className="p-0 overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex flex-col justify-center items-center h-[400px] text-muted-foreground">
            <Loader2 size={32} className="animate-spin mb-4" />
            <p>Cargando agenda...</p>
          </div>
        ) : filteredApts.length === 0 ? (
          <div className="text-center py-20 animate-in fade-in zoom-in-95 duration-300">
            <CalendarDays size={48} className="text-muted-foreground mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium text-foreground">No hay citas registradas</p>
            <p className="text-sm text-muted-foreground mt-1">Para el día seleccionado no hay actividad.</p>
            <Link href="/dashboard/appointments/new">
              <Button variant="secondary" className="mt-4">Agendar Cita</Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border animate-in fade-in duration-300">
            {filteredApts.map((apt) => (
              <div
                key={apt.id}
                className="flex items-start sm:items-center gap-4 p-4 hover:bg-surface transition-colors group"
              >
                {/* Time */}
                <div className="text-center w-14 flex-shrink-0 pt-1 sm:pt-0">
                  <p className="text-sm font-bold text-foreground">{formatTime(apt.start_at)}</p>
                  <p className="text-xs text-muted-foreground">{formatTime(apt.end_at)}</p>
                </div>

                {/* Color bar */}
                <div
                  className="w-1 h-12 sm:h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: apt.service?.color || '#ccc' }}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-foreground group-hover:text-brand-600 transition-colors">
                      {apt.client?.name || 'Cliente desconocido'}
                    </p>
                    {apt.is_dual_booking && <DualBookingBadge />}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span>{apt.service?.name} ({apt.service?.duration_min} min)</span>
                    <span className="hidden sm:inline text-border">•</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {apt.assigned_user?.name || 'Sin asignar'}</span>
                  </p>
                </div>

                {/* Status & Price */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <AppointmentStatusBadge status={apt.status || 'pending'} />
                  <p className="text-xs font-semibold text-foreground">
                    {formatCurrency(apt.service?.price || 0)}
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
