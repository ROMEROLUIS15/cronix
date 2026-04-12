"use client"

import { format }    from "date-fns"
import { es }        from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface MonthNavigatorProps {
  currentMonth: Date
  onPrev:       () => void
  onNext:       () => void
}

/** MonthNavigator — prev/next month controls with centered month+year display. */
export function MonthNavigator({ currentMonth, onPrev, onNext }: MonthNavigatorProps) {
  const btnStyle = {
    background: "rgba(255,255,255,0.05)",
    color:      "#8A8A90",
    border:     "1px solid rgba(255,255,255,0.07)",
  } as const

  return (
    <div
      className="flex items-center justify-between px-4 md:px-5 py-3 rounded-2xl"
      style={{
        background:  "linear-gradient(135deg, #1A1A22 0%, #16161E 100%)",
        border:      "1px solid #2E2E3E",
        boxShadow:   "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <button onClick={onPrev} className="p-2.5 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95" style={btnStyle}>
        <ChevronLeft size={18} />
      </button>

      <div className="text-center">
        <p className="text-base sm:text-lg font-black capitalize" style={{ color: "#F0F0F5", letterSpacing: "-0.03em" }}>
          {format(currentMonth, "MMMM", { locale: es })}
        </p>
        <p className="text-xs font-bold tracking-widest" style={{ color: "#3884FF", opacity: 0.9 }}>
          {format(currentMonth, "yyyy")}
        </p>
      </div>

      <button onClick={onNext} className="p-2.5 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95" style={btnStyle}>
        <ChevronRight size={18} />
      </button>
    </div>
  )
}
