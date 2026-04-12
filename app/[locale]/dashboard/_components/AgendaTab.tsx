"use client"

import { MonthNavigator } from "./MonthNavigator"
import { CalendarLegend } from "./CalendarLegend"
import { CalendarGrid }   from "./CalendarGrid"
import { MonthStats }     from "./MonthStats"
import type { AppointmentWithRelations } from "@/types"

interface AgendaTabProps {
  currentMonth:  Date
  selectedDate:  Date
  monthApts:     AppointmentWithRelations[]
  calendarDays:  Date[]
  loading:       boolean
  dayPanelOpen:  boolean
  onPrevMonth:   () => void
  onNextMonth:   () => void
  onDayClick:    (day: Date) => void
}

/**
 * AgendaTab — Composes the calendar view: navigator, legend, grid, month stats.
 * Pure compositor — no state, no data fetching.
 */
export function AgendaTab({
  currentMonth, selectedDate, monthApts, calendarDays,
  loading, dayPanelOpen, onPrevMonth, onNextMonth, onDayClick,
}: AgendaTabProps) {
  return (
    <div className="space-y-3">
      <MonthNavigator currentMonth={currentMonth} onPrev={onPrevMonth} onNext={onNextMonth} />
      <CalendarLegend />
      <CalendarGrid
        calendarDays={calendarDays}
        monthApts={monthApts}
        selectedDate={selectedDate}
        currentMonth={currentMonth}
        dayPanelOpen={dayPanelOpen}
        loading={loading}
        onDayClick={onDayClick}
      />
      <MonthStats monthApts={monthApts} />
    </div>
  )
}
