import type { Metadata } from 'next'
import {
  CalendarDays, Users, DollarSign, TrendingUp,
  Clock, CheckCircle2, Star, ArrowRight, Plus,
} from 'lucide-react'
import Link from 'next/link'
import { StatCard } from '@/components/ui/card'
import { AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mockDashboardStats } from '@/lib/mock/data'
import { formatTime, formatCurrency } from '@/lib/utils'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await getSession()
  if (!session || !session.business_id) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md p-8 card-base">
          <div className="h-16 w-16 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users size={32} />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Configuración requerida</h2>
          <p className="text-muted-foreground mb-6">
            Tu perfil aún no está vinculado a un negocio. Esto puede suceder si el registro no se completó correctamente.
          </p>
          <div className="flex flex-col gap-3">
            <Button variant="primary" className="w-full">Completar Perfil</Button>
            <Link href="/login" className="text-sm text-brand-600 hover:underline">
              Volver a iniciar sesión
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const supabase = createClient()
  const todayStart = format(new Date(), 'yyyy-MM-dd')
  const todayEnd = format(new Date(new Date().getTime() + 24 * 60 * 60 * 1000 - 1), 'yyyy-MM-dd HH:mm:ss')

  const { data: todayAppointmentsData } = await supabase
    .from('appointments')
    .select(`
      *,
      client:clients(id, name, phone, avatar_url),
      service:services(id, name, color, duration_min, price),
      assigned_user:users(id, name, avatar_url, color)
    `)
    .eq('business_id', session.business_id)
    .gte('start_at', todayStart)
    .lt('start_at', todayEnd)
    .order('start_at', { ascending: true })

  const stats = mockDashboardStats
  const todayAppointments = todayAppointmentsData || []
  const userFirstName = session.dbUser?.name?.split(' ')[0] || 'Usuario'

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Buenos días, {userFirstName} 👋</h1>
          <p className="text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link href="/dashboard/appointments/new">
          <Button leftIcon={<Plus size={16} />}>Nueva Cita</Button>
        </Link>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Citas hoy"
          value={stats.appointmentsToday}
          subtitle={`${stats.pendingAppointments} pendientes`}
          icon={<CalendarDays size={22} />}
          accent
        />
        <StatCard
          title="Clientes totales"
          value={stats.totalClients}
          icon={<Users size={22} />}
          trend={{ value: 12, label: 'este mes' }}
        />
        <StatCard
          title="Ingresos del mes"
          value={formatCurrency(stats.revenueThisMonth)}
          icon={<DollarSign size={22} />}
          trend={{ value: 8, label: 'vs mes anterior' }}
        />
        <StatCard
          title="Esta semana"
          value={stats.appointmentsThisWeek}
          subtitle="citas agendadas"
          icon={<TrendingUp size={22} />}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Today's appointments */}
        <div className="lg:col-span-2">
          <div className="card-base">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold text-foreground">Citas de hoy</h2>
                <p className="text-xs text-muted-foreground">{todayAppointments.length} citas agendadas</p>
              </div>
              <Link href="/dashboard/appointments" className="text-sm text-brand-600 hover:underline flex items-center gap-1">
                Ver todo <ArrowRight size={14} />
              </Link>
            </div>

            <div className="space-y-3">
              {todayAppointments.length === 0 ? (
                <div className="text-center py-10">
                  <CalendarDays size={40} className="text-muted-foreground mx-auto mb-3 opacity-40" />
                  <p className="text-sm text-muted-foreground">No hay citas para hoy</p>
                  <Link href="/dashboard/appointments/new" className="mt-3 block">
                    <Button variant="secondary" size="sm">
                      Agendar primera cita
                    </Button>
                  </Link>
                </div>
              ) : (
                todayAppointments.map((apt) => (
                  <div
                    key={apt.id}
                    className="flex items-center gap-4 p-4 rounded-2xl border border-border hover:border-brand-200 hover:bg-surface transition-all duration-150 group"
                  >
                    {/* Time indicator */}
                    <div className="text-center w-12 flex-shrink-0">
                      <p className="text-sm font-bold text-foreground">{formatTime(apt.start_at)}</p>
                      <p className="text-[10px] text-muted-foreground">{formatTime(apt.end_at)}</p>
                    </div>

                    {/* Service color bar */}
                    <div
                      className="w-1 h-10 rounded-full flex-shrink-0"
                      style={{ backgroundColor: apt.service.color }}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{apt.client.name}</p>
                        {apt.is_dual_booking && <DualBookingBadge />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {apt.service?.name} · {apt.service?.duration_min} min · {apt.assigned_user?.name || 'Sin asignar'}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <AppointmentStatusBadge status={apt.status} />
                      <p className="text-xs font-medium text-foreground">
                        {formatCurrency(apt.service.price)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Quick actions & summary */}
        <div className="space-y-4">
          {/* Quick actions */}
          <div className="card-base">
            <h2 className="text-base font-semibold text-foreground mb-4">Acciones rápidas</h2>
            <div className="space-y-2">
              {[
                { href: '/dashboard/appointments/new', label: 'Nueva cita', icon: CalendarDays, primary: true },
                { href: '/dashboard/clients/new',      label: 'Nuevo cliente', icon: Users },
                { href: '/dashboard/finances/new',     label: 'Registrar cobro', icon: DollarSign },
              ].map((action) => {
                const Icon = action.icon
                return action.primary ? (
                  <Link key={action.href} href={action.href} className="btn-primary w-full justify-start gap-3">
                    <Icon size={16} /> {action.label}
                  </Link>
                ) : (
                  <Link key={action.href} href={action.href} className="btn-secondary w-full justify-start gap-3 text-sm">
                    <Icon size={16} /> {action.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Today summary */}
          <div className="card-base bg-brand-600 text-white border-brand-700">
            <h2 className="text-sm font-semibold text-brand-100 mb-4">Resumen de hoy</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-brand-100">
                  <CheckCircle2 size={16} /> Completadas
                </span>
                <span className="font-bold text-white">{stats.completedToday}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-brand-100">
                  <Clock size={16} /> Pendientes
                </span>
                <span className="font-bold text-white">{stats.pendingAppointments}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-brand-100">
                  <Star size={16} /> Doble agenda
                </span>
                <span className="font-bold text-white">
                  {todayAppointments.filter(a => a.is_dual_booking).length}
                </span>
              </div>
              <div className="pt-2 border-t border-brand-500">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-brand-100">Ingresos hoy</span>
                  <span className="font-bold text-white">{formatCurrency(97000)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
