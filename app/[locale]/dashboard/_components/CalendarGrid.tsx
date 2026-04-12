"use client"

import { format, isSameDay, isSameMonth, parseISO } from "date-fns"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { getStatusColor } from "../_constants"
import type { AppointmentWithRelations } from "@/types"

interface CalendarGridProps {
  calendarDays:  Date[]
  monthApts:     AppointmentWithRelations[]
  selectedDate:  Date
  currentMonth:  Date
  dayPanelOpen:  boolean
  loading:       boolean
  onDayClick:    (day: Date) => void
}

/** CalendarGrid — Full month grid with appointment chips per day. */
export function CalendarGrid({
  calendarDays, monthApts, selectedDate, currentMonth, dayPanelOpen, loading, onDayClick,
}: CalendarGridProps) {
  const t = useTranslations('dashboard')
  const weekHeaders = t.raw('weekHeaders') as readonly string[]
  const today = new Date()

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#18181F",
        border:     "1px solid #2A2A38",
        boxShadow:  "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(56,132,255,0.05), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Week headers */}
      <div
        className="grid grid-cols-7"
        style={{ borderBottom: "1px solid #2A2A38", background: "linear-gradient(180deg, #22222E 0%, #1C1C28 100%)" }}
      >
        {weekHeaders.map((d, i) => (
          <div key={i} className="py-3.5 text-center">
            <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: "#5A5A72" }}>{d}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 size={28} className="animate-spin" style={{ color: "#0062FF" }} />
        </div>
      ) : (
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const apts        = monthApts.filter(a => isSameDay(parseISO(a.start_at), day))
            const isToday     = isSameDay(day, today)
            const isSelected  = isSameDay(day, selectedDate) && dayPanelOpen
            const isThisMonth = isSameMonth(day, currentMonth)
            const colIdx      = idx % 7

            const baseBg = isSelected
              ? "rgba(56,132,255,0.14)"
              : isToday   ? "rgba(56,132,255,0.07)"
              : isThisMonth ? "#1E1E28" : "#16161C"

            const hoverBg = isToday
              ? "rgba(56,132,255,0.14)"
              : isThisMonth ? "#262634" : "#1C1C24"

            const leaveBg = isToday
              ? "rgba(56,132,255,0.07)"
              : isThisMonth ? "#1E1E28" : "#16161C"

            return (
              <button
                key={day.toISOString()}
                onClick={() => onDayClick(day)}
                className="relative min-h-[72px] sm:min-h-[76px] md:min-h-[80px] p-1.5 sm:p-2 text-left transition-all duration-150"
                style={{
                  borderRight:  colIdx < 6 ? "1px solid #242430" : "none",
                  borderBottom: idx < calendarDays.length - 7 ? "1px solid #242430" : "none",
                  background:   baseBg,
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = hoverBg }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = leaveBg }}
              >
                {/* Day number */}
                <div
                  className="h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold mb-1.5"
                  style={
                    isToday    ? { background: "#3884FF", color: "#fff", boxShadow: "0 0 12px rgba(56,132,255,0.6)" }
                    : isSelected ? { color: "#63B3FF", background: "rgba(56,132,255,0.18)" }
                    : { color: isThisMonth ? "#D8D8E8" : "#3A3A4A" }
                  }
                >
                  {format(day, "d")}
                </div>

                {/* Appointment chips */}
                {apts.length > 0 && (
                  <div className="space-y-0.5">
                    {apts.slice(0, 3).map(apt => {
                      const color = getStatusColor(apt.status)
                      return (
                        <div
                          key={apt.id}
                          className="w-full rounded-md px-1.5 py-1 text-[10px] font-bold truncate leading-tight"
                          style={{
                            background:      `${color}28`,
                            color,
                            border:          `1px solid ${color}50`,
                            borderLeftWidth: "2px",
                            borderLeftColor: color,
                          }}
                        >
                          {apt.client?.name?.split(" ")[0] ?? ""}
                        </div>
                      )
                    })}
                    {apts.length > 3 && (
                      <div className="text-[9px] font-bold px-1 mt-0.5" style={{ color: "#6A6A72" }}>
                        +{apts.length - 3} más
                      </div>
                    )}
                  </div>
                )}

                {/* Selected indicator dot */}
                {isSelected && (
                  <div
                    className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
                    style={{ background: "#0062FF", boxShadow: "0 0 6px rgba(0,98,255,0.8)" }}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
