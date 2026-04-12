"use client"

import Link from "next/link"
import { format } from "date-fns"
import { es }     from "date-fns/locale"
import { CalendarDays, BarChart3, DollarSign, User, Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

interface DashboardHeaderProps {
  tab:          "agenda" | "resumen"
  onTabChange:  (tab: "agenda" | "resumen") => void
  userName:     string | null | undefined
}

/**
 * DashboardHeader — Greeting, date, tabs, and quick-action buttons.
 * Pure display — receives tab state and callbacks from parent.
 */
export function DashboardHeader({ tab, onTabChange, userName }: DashboardHeaderProps) {
  const t     = useTranslations('dashboard')
  const today = new Date()

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-black" style={{ color: "#F5F5F5", letterSpacing: "-0.03em" }}>
          {t('greeting')}, {userName} 👋
        </h1>
        <p className="text-xs sm:text-sm capitalize mt-0.5" style={{ color: "#8A8A90" }}>
          {format(today, "EEEE d 'de' MMMM yyyy", { locale: es })}
        </p>
      </div>

      {/* Mobile: 2x2 grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:hidden">
        <button
          onClick={() => onTabChange("agenda")}
          className="w-full h-11 text-[13px] font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
          style={tab === "agenda"
            ? { background: "#0062FF", color: "#fff", border: "1px solid #0062FF", boxShadow: "0 4px 12px rgba(0,98,255,0.25)" }
            : { background: "rgba(0,98,255,0.08)", color: "#3884FF", border: "1px solid rgba(0,98,255,0.15)" }}
        >
          <CalendarDays size={16} /><span>{t('tabs.agenda')}</span>
        </button>

        <Link href="/dashboard/finances/new" className="w-full">
          <button className="w-full h-11 text-[13px] font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
            style={{ background: "rgba(48,209,88,0.1)", color: "#30D158", border: "1px solid rgba(48,209,88,0.15)" }}>
            <DollarSign size={16} /><span>{t('quickActions.registerPayment')}</span>
          </button>
        </Link>

        <Link href="/dashboard/clients/new" className="w-full">
          <Button variant="primary" className="w-full h-11 justify-center text-[13px] rounded-xl font-bold"
            style={{ background: "#0062FF", color: "#fff", border: "1px solid #0062FF", boxShadow: "0 4px 12px rgba(0,98,255,0.25)" }}
            leftIcon={<User size={16} />}>
            {t('quickActions.newClient')}
          </Button>
        </Link>

        <Link href="/dashboard/appointments/new" className="w-full">
          <Button variant="primary" className="w-full h-11 justify-center text-[13px] rounded-xl font-bold"
            style={{ background: "#0062FF", color: "#fff", border: "1px solid #0062FF", boxShadow: "0 4px 12px rgba(0,98,255,0.25)" }}
            leftIcon={<Plus size={16} />}>
            {t('quickActions.newAppointment')}
          </Button>
        </Link>
      </div>

      {/* sm+: 4–5 column action bar */}
      <div className="hidden sm:grid grid-cols-4 lg:grid-cols-5 gap-3 w-full mt-2">
        {(["agenda", "resumen"] as const).map(tb => (
          <button
            key={tb}
            onClick={() => onTabChange(tb)}
            className="w-full h-11 text-sm font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
            style={tab === tb
              ? { background: "rgba(0,98,255,1)", color: "#fff", border: "1px solid #0062FF", boxShadow: "0 0 15px rgba(0,98,255,0.4)" }
              : { background: "rgba(0,98,255,1)", color: "#fff", border: "1px solid #0062FF", opacity: 0.85 }}
          >
            {tb === "agenda"
              ? <><CalendarDays size={18} /><span>{t('tabs.agenda')}</span></>
              : <><BarChart3   size={18} /><span>{t('tabs.metrics')}</span></>}
          </button>
        ))}

        <Link href="/dashboard/clients/new" className="w-full">
          <Button variant="primary" className="w-full h-11 text-sm rounded-xl font-bold transition-all"
            style={{ background: "rgba(0,98,255,1)", color: "#fff", border: "1px solid #0062FF", boxShadow: "0 0 15px rgba(0,98,255,0.4)" }}
            leftIcon={<User size={18} />}>
            {t('quickActions.newClient')}
          </Button>
        </Link>

        <Link href="/dashboard/finances/new" className="w-full hidden lg:block">
          <Button variant="secondary" className="w-full h-11 text-sm rounded-xl font-semibold transition-all hover:bg-emerald-900/30 hover:border-emerald-500/50"
            style={{ background: "rgba(48,209,88,0.05)", color: "#30D158", border: "1px solid rgba(48,209,88,0.2)" }}
            leftIcon={<DollarSign size={18} />}>
            {t('quickActions.registerPayment')}
          </Button>
        </Link>

        <Link href="/dashboard/appointments/new" className="w-full">
          <Button variant="primary" className="w-full h-11 text-sm rounded-xl font-bold uppercase tracking-wide"
            style={{ background: "#F5F5F5", color: "#000", border: "none" }}
            leftIcon={<Plus size={18} />}>
            {t('quickActions.newAppointment')}
          </Button>
        </Link>
      </div>
    </div>
  )
}
