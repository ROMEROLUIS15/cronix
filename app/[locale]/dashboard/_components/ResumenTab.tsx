"use client"

import Link from "next/link"
import { format } from "date-fns"
import { es }     from "date-fns/locale"
import { CalendarDays, DollarSign, Users, TrendingUp, ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { StatCard } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"
import type { DashboardStats } from "../_hooks/useDashboard"

interface ResumenTabProps {
  stats: DashboardStats
}

/** ResumenTab — KPI overview with stat cards and quick navigation links. */
export function ResumenTab({ stats }: ResumenTabProps) {
  const t = useTranslations('dashboard')

  const quickActions = [
    { href: "/dashboard/appointments/new", label: "Nueva cita",       icon: CalendarDays, primary: true  },
    { href: "/dashboard/clients/new",      label: "Nuevo cliente",    icon: Users,        primary: false },
    { href: "/dashboard/finances/new",     label: "Registrar cobro",  icon: DollarSign,   primary: false },
  ] as const

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

      <div className="card-base">
        <h2 className="text-base font-bold mb-4" style={{ color: "#F5F5F5" }}>Acciones rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickActions.map(action => {
            const Icon = action.icon
            return (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-3 p-3 rounded-xl text-sm font-semibold transition-all duration-200"
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
