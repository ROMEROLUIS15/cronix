"use client"

import { useTranslations } from "next-intl"
import type { AppointmentWithRelations } from "@/types"

interface MonthStatsProps {
  monthApts: AppointmentWithRelations[]
}

/** MonthStats — 4 stat tiles summarizing the month's appointment counts. */
export function MonthStats({ monthApts }: MonthStatsProps) {
  const t = useTranslations('dashboard')

  const items = [
    {
      value:  monthApts.filter(a => a.status !== "cancelled").length,
      label:  t('stats.activeAppointments'),
      color:  "#F0F0F5",
      glow:   "rgba(255,255,255,0.05)",
      border: "#2A2A38",
    },
    {
      value:  monthApts.filter(a => a.status === "pending").length,
      label:  t('stats.pending'),
      color:  "#FFD60A",
      glow:   "rgba(255,214,10,0.08)",
      border: "rgba(255,214,10,0.2)",
    },
    {
      value:  monthApts.filter(a => a.status === "completed").length,
      label:  t('stats.completed'),
      color:  "#30D158",
      glow:   "rgba(48,209,88,0.08)",
      border: "rgba(48,209,88,0.2)",
    },
    {
      value:  monthApts.filter(a => a.status === "confirmed").length,
      label:  t('stats.confirmed'),
      color:  "#3884FF",
      glow:   "rgba(56,132,255,0.08)",
      border: "rgba(56,132,255,0.2)",
    },
  ] as const

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(s => (
        <div
          key={s.label}
          className="flex flex-col items-center justify-center py-4 px-3 rounded-2xl"
          style={{
            background: "linear-gradient(135deg, #1A1A22 0%, #16161E 100%)",
            border:     `1px solid ${s.border}`,
            boxShadow:  `0 4px 20px ${s.glow}, inset 0 1px 0 rgba(255,255,255,0.03)`,
          }}
        >
          <p className="text-2xl font-black" style={{ color: s.color, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {s.value}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest mt-1.5" style={{ color: "#5A5A6A" }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  )
}
