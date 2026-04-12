"use client"

import { useTranslations } from "next-intl"

/** CalendarLegend — Color reference for appointment statuses. Pure display. */
export function CalendarLegend() {
  const t = useTranslations('dashboard')

  const items = [
    { color: "#FFD60A", label: t('status.pending')   },
    { color: "#3884FF", label: t('status.confirmed') },
    { color: "#30D158", label: t('status.completed') },
    { color: "#FF3B30", label: t('status.cancelled') },
  ] as const

  return (
    <div
      className="flex flex-wrap items-center gap-4 sm:gap-6 px-5 py-3.5 rounded-2xl"
      style={{
        background: "linear-gradient(180deg, #22222E 0%, #1C1C28 100%)",
        border:     "1px solid #2A2A38",
        boxShadow:  "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {items.map(l => (
        <div key={l.label} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full flex-shrink-0"
            style={{ background: l.color, boxShadow: `0 0 5px ${l.color}80` }}
          />
          <span className="text-[11px] font-semibold" style={{ color: "#9A9AAA" }}>
            {l.label}
          </span>
        </div>
      ))}
    </div>
  )
}
