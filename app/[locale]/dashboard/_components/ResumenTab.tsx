"use client"

import { Link } from '@/i18n/navigation'
import { format, parseISO } from "date-fns"
import { es }     from "date-fns/locale"
import { CalendarDays, DollarSign, Users, TrendingUp, ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { StatCard } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"
import type { DashboardStats } from "../_hooks/useDashboard"
import type { AppointmentWithRelations } from "@/types"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts"
import { useMemo } from "react"

interface ResumenTabProps {
  stats: DashboardStats
  monthApts?: AppointmentWithRelations[]
}

const COLORS = ["#0062FF", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#6B7280"]

/** ResumenTab — KPI overview with stat cards, quick navigation, and Recharts analytics. */
export function ResumenTab({ stats, monthApts = [] }: ResumenTabProps) {
  const t = useTranslations('dashboard')

  const quickActions = [
    { href: "/dashboard/appointments/new", label: "Nueva cita",       icon: CalendarDays, primary: true  },
    { href: "/dashboard/clients/new",      label: "Nuevo cliente",    icon: Users,        primary: false },
    { href: "/dashboard/finances/new",     label: "Registrar cobro",  icon: DollarSign,   primary: false },
  ] as const

  // ── Analytics Calculators (Memoized) ─────────────────────────

  // 1. Staff Revenue (Group by Assigned User)
  const staffData = useMemo(() => {
    const map = new Map<string, number>()
    monthApts.forEach(apt => {
      // Sólo sumar ingresos cobrados / completados
      if (apt.status !== 'completed') return
      
      const prev = map.get(apt.assigned_user?.name ?? 'Sin asignar') ?? 0
      map.set(apt.assigned_user?.name ?? 'Sin asignar', prev + (apt.service?.price ?? 0))
    })
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [monthApts])

  // 2. Status Breakdown (Pie Chart)
  const statusData = useMemo(() => {
    const counts = {
      Completada: 0,
      Confirmada: 0,
      Pendiente: 0,
      NoAsistió: 0,
      Cancelada: 0,
    }
    monthApts.forEach(apt => {
      if (apt.status === 'completed') counts.Completada++
      else if (apt.status === 'confirmed') counts.Confirmada++
      else if (apt.status === 'pending') counts.Pendiente++
      else if (apt.status === 'no_show') counts.NoAsistió++
      else if (apt.status === 'cancelled') counts.Cancelada++
    })
    
    return [
      { name: 'Completada', value: counts.Completada, color: '#10B981' }, // emerald
      { name: 'Confirmada', value: counts.Confirmada, color: '#3B82F6' }, // blue
      { name: 'Pendiente',  value: counts.Pendiente,  color: '#F59E0B' }, // amber
      { name: 'No Asistió', value: counts.NoAsistió,  color: '#EF4444' }, // red
      { name: 'Cancelada',  value: counts.Cancelada,  color: '#6B7280' }, // gray
    ].filter(item => item.value > 0)
  }, [monthApts])

  // 3. Daily Revenue over the Month
  const dailyData = useMemo(() => {
    const map = new Map<string, number>()
    monthApts.forEach(apt => {
      // Sólo sumar ingresos cobrados / completados
      if (apt.status !== 'completed') return
      
      const day = format(parseISO(apt.start_at), 'dd MMM', { locale: es })
      const prev = map.get(day) ?? 0
      map.set(day, prev + (apt.service?.price ?? 0))
    })
    return Array.from(map.entries()).map(([day, total]) => ({ day, total }))
  }, [monthApts])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title={t('stats.appointmentsToday')}
          value={stats.todayCount}
          subtitle={`${stats.pending} ${t('stats.pending').toLowerCase()}`}
          icon={<CalendarDays size={22} />}
          accent
        />
        <StatCard title={t('stats.totalClients')}        value={stats.totalClients}               icon={<Users      size={22} />} />
        <StatCard title={t('stats.monthRevenue')}        value={formatCurrency(stats.monthRevenue)} icon={<DollarSign size={22} />} />
        <StatCard
          title={t('stats.pendingConfirmation')}
          value={stats.pending}
          subtitle={`${t('stats.pending')} ${t('tabs.agenda').toLowerCase()}`}
          icon={<TrendingUp size={22} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico 1: Rendimiento por Staff */}
        <div className="card-base">
          <h2 className="text-base font-bold mb-4" style={{ color: "#F5F5F5" }}>Ingresos por Especialista</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={staffData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#52525B" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#52525B" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip 
                  cursor={{ fill: '#27272A' }}
                  contentStyle={{ backgroundColor: '#18181B', border: '1px solid #3F3F46', borderRadius: '8px', color: '#F5F5F5' }}
                  formatter={(value: any) => [formatCurrency(Number(value) || 0), 'Ingresos']}
                />
                <Bar dataKey="value" fill="#0062FF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Desglose de Status */}
        <div className="card-base flex flex-col">
          <h2 className="text-base font-bold mb-4" style={{ color: "#F5F5F5" }}>Tasa de Asistencia (No-Shows)</h2>
          <div className="flex-1 min-h-[256px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181B', border: '1px solid #3F3F46', borderRadius: '8px', color: '#F5F5F5' }}
                  formatter={(value: any) => [value, 'Citas']}
                />
                <Legend 
                  verticalAlign="bottom" 
                  align="center"
                  iconType="circle"
                  wrapperStyle={{ 
                    fontSize: '12px', 
                    color: '#A1A1AA',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '12px',
                    paddingTop: '16px'
                  }} 
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card-base">
        <h2 className="text-base font-bold mb-4" style={{ color: "#F5F5F5" }}>Acciones rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickActions.map(action => {
            const Icon = action.icon
            return (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-3 p-3 rounded-xl text-sm font-semibold transition-all duration-200 hover:opacity-80"
                style={action.primary
                  ? { background: "#0062FF", color: "#fff",    border: "1px solid #0062FF" }
                  : { background: "#1E1E21", color: "#F5F5F5", border: "1px solid #262629" }}
              >
                <Icon size={16} /> {action.label}
                <ArrowRight size={14} className="ml-auto opacity-50" />
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
