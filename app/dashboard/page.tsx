import type { Metadata } from 'next'
import { CalendarDays, Users, DollarSign, TrendingUp, Plus, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { StatCard } from '@/components/ui/card'
import { AppointmentStatusBadge, DualBookingBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTime, formatCurrency } from '@/lib/utils'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import type { AppointmentStatus } from '@/types'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await getSession()

  // No business yet — redirect to setup
  if (!session || !session.business_id) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md p-8 card-base">
          <div className="h-16 w-16 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users size={32} />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">¡Bienvenido a Agendo!</h2>
          <p className="text-muted-foreground mb-6">
            Para comenzar necesitas configurar tu negocio. Solo toma un minuto.
          </p>
          <Link href="/dashboard/setup" className="w-full block">
            <Button className="w-full">Configurar mi negocio</Button>
          </Link>
        </div>
      </div>
    )
  }

  const supabase = await createClient()
  const bId = session.business_id
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')

  const [aptsRes, clientsRes, revenueRes, pendingRes] = await Promise.all([
    supabase
      .from('appointments')
      .select(`*, client:clients(id,name,phone,avatar_url), service:services(id,name,color,duration_min,price), assigned_user:users(id,name,avatar_url,color)`)
      .eq('business_id', bId)
      .gte('start_at', `${todayStr}T00:00:00`)
      .lte('start_at', `${todayStr}T23:59:59`)
      .order('start_at', { ascending: true }),

    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', bId)
      .is('deleted_at', null),

    supabase
      .from('transactions')
      .select('net_amount')
      .eq('business_id', bId)
      .gte('paid_at', `${monthStart}T00:00:00`),

    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', bId)
      .eq('status', 'pending'),
  ])

  const todayAppointments = aptsRes.data ?? []
  const totalClients = clientsRes.count ?? 0
  const revenueThisMonth = (revenueRes.data ?? []).reduce((s, t) => s + (t.net_amount ?? 0), 0)
  const pendingCount = pendingRes.count ?? 0
  const userFirstName = session.dbUser?.name?.split(' ')[0] || 'Usuario'

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Buenos días, {userFirstName} 👋
          </h1>
          <p className="text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('es-CO', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            })}
          </p>
        </div>
        <Link href="/dashboard/appointments/new">
          <Button leftIcon={<Plus size={16} />}>Nueva Cita</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Citas hoy"
          value={todayAppointments.length}
          subtitle={`${pendingCount} pendientes`}
          icon={<CalendarDays size={22} />}
          accent
        />
        <StatCard title="Clientes totales" value={totalClients} icon={<Users size={22} />} />
        <StatCard
          title="Ingresos del mes"
          value={formatCurrency(revenueThisMonth)}
          icon={<DollarSign size={22} />}
        />
        <StatCard
          title="Por confirmar"
          value={pendingCount}
          subtitle="citas pendientes"
          icon={<TrendingUp size={22} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

            {todayAppointments.length === 0 ? (
              <div className="text-center py-10">
                <CalendarDays size={40} className="text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">No hay citas para hoy</p>
                <Link href="/dashboard/appointments/new" className="mt-3 block">
                  <Button variant="secondary" size="sm">Agendar primera cita</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {todayAppointments.map((apt: any) => (
                  <div key={apt.id} className="flex items-center gap-4 p-4 rounded-3xl border border-border/60 hover:border-brand-400 hover:bg-brand-50/50 transition-all duration-300 group shadow-sm hover:shadow-md">
                    <div className="text-center w-14 flex-shrink-0">
                      <p className="text-sm font-extrabold text-foreground">{formatTime(apt.start_at)}</p>
                      <p className="text-[10px] font-medium text-muted-foreground">{formatTime(apt.end_at)}</p>
                    </div>
                    <div className="w-1.5 h-12 rounded-full flex-shrink-0"
                      style={{ backgroundColor: apt.service?.color ?? '#ccc' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-foreground group-hover:text-brand-600 transition-colors">
                          {apt.client?.name ?? 'Cliente desconocido'}
                        </p>
                        {apt.is_dual_booking && <DualBookingBadge />}
                      </div>
                      <p className="text-xs font-medium text-muted-foreground mt-0.5">
                        {apt.service?.name} · {apt.service?.duration_min} min · {apt.assigned_user?.name ?? 'Sin asignar'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <AppointmentStatusBadge status={(apt.status ?? 'pending') as AppointmentStatus} />
                      <p className="text-sm font-extrabold text-foreground">
                        {formatCurrency(apt.service?.price ?? 0)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card-base">
            <h2 className="text-base font-semibold text-foreground mb-4">Acciones rápidas</h2>
            <div className="space-y-2">
              {[
                { href: '/dashboard/appointments/new', label: 'Nueva cita', icon: CalendarDays, primary: true },
                { href: '/dashboard/clients/new', label: 'Nuevo cliente', icon: Users },
                { href: '/dashboard/finances/new', label: 'Registrar cobro', icon: DollarSign },
              ].map((action) => {
                const Icon = action.icon
                return action.primary ? (
                  <Link key={action.href} href={action.href}
                    className="btn-primary w-full justify-start gap-3 flex items-center p-2 rounded-lg">
                    <Icon size={16} /> {action.label}
                  </Link>
                ) : (
                  <Link key={action.href} href={action.href}
                    className="btn-secondary w-full justify-start gap-3 text-sm flex items-center p-2 rounded-lg border border-border">
                    <Icon size={16} /> {action.label}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}