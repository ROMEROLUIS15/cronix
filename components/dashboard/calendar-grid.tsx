'use client'

import { memo } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { format, isSameDay, isSameMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AppointmentWithRelations } from '@/types'

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFD60A',
  confirmed: '#0062FF',
  completed: '#30D158',
  cancelled: '#FF3B30',
  no_show: '#8A8A90',
}

interface CalendarGridProps {
  calendarDays: Date[]
  currentMonth: Date
  selectedDate: Date
  dayPanelOpen: boolean
  loading: boolean
  today: Date
  monthApts: AppointmentWithRelations[]
  onDayClick: (day: Date) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}

const WEEK_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function CalendarGridInner({
  calendarDays,
  currentMonth,
  selectedDate,
  dayPanelOpen,
  loading,
  today,
  monthApts,
  onDayClick,
  onPrevMonth,
  onNextMonth,
}: CalendarGridProps) {
  const getAptsForDay = (day: Date) =>
    monthApts.filter((a) => isSameDay(new Date(a.start_at), day))

  return (
    <div className="space-y-3">
      {/* Month navigator */}
      <div
        className="flex items-center justify-between px-4 md:px-5 py-3 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, #1A1A22 0%, #16161E 100%)',
          border: '1px solid #2E2E3E',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <button
          onClick={onPrevMonth}
          className="p-2.5 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95"
          style={{
            background: 'rgba(255,255,255,0.05)',
            color: '#8A8A90',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p
            className="text-base sm:text-lg font-black capitalize"
            style={{ color: '#F0F0F5', letterSpacing: '-0.03em' }}
          >
            {format(currentMonth, 'MMMM', { locale: es })}
          </p>
          <p
            className="text-xs font-bold tracking-widest"
            style={{ color: '#3884FF', opacity: 0.9 }}
          >
            {format(currentMonth, 'yyyy')}
          </p>
        </div>
        <button
          onClick={onNextMonth}
          className="p-2.5 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95"
          style={{
            background: 'rgba(255,255,255,0.05)',
            color: '#8A8A90',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Legend */}
      <div
        className="flex flex-wrap items-center gap-4 sm:gap-6 px-5 py-3.5 rounded-2xl"
        style={{
          background: 'linear-gradient(180deg, #22222E 0%, #1C1C28 100%)',
          border: '1px solid #2A2A38',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {[
          { color: '#FFD60A', label: 'Pendiente' },
          { color: '#3884FF', label: 'Confirmada' },
          { color: '#30D158', label: 'Completada' },
          { color: '#FF3B30', label: 'Cancelada' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ background: l.color, boxShadow: `0 0 5px ${l.color}80` }}
            />
            <span className="text-[11px] font-semibold" style={{ color: '#9A9AAA' }}>
              {l.label}
            </span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: '#18181F',
          border: '1px solid #2A2A38',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(56,132,255,0.05), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* Week headers */}
        <div
          className="grid grid-cols-7"
          style={{
            borderBottom: '1px solid #2A2A38',
            background: 'linear-gradient(180deg, #22222E 0%, #1C1C28 100%)',
          }}
        >
          {WEEK_HEADERS.map((d) => (
            <div key={d} className="py-3.5 text-center">
              <span
                className="text-[11px] font-black uppercase tracking-widest"
                style={{ color: '#5A5A72' }}
              >
                {d}
              </span>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 size={28} className="animate-spin" style={{ color: '#0062FF' }} />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, idx) => {
              const apts = getAptsForDay(day)
              const isToday = isSameDay(day, today)
              const isSelected = isSameDay(day, selectedDate) && dayPanelOpen
              const isThisMonth = isSameMonth(day, currentMonth)
              const hasApts = apts.length > 0
              const colIdx = idx % 7

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => onDayClick(day)}
                  className="relative min-h-[72px] sm:min-h-[76px] md:min-h-[80px] p-1.5 sm:p-2 text-left transition-all duration-150 group"
                  style={{
                    borderRight: colIdx < 6 ? '1px solid #242430' : 'none',
                    borderBottom: idx < calendarDays.length - 7 ? '1px solid #242430' : 'none',
                    background: isSelected
                      ? 'rgba(56,132,255,0.14)'
                      : isToday
                        ? 'rgba(56,132,255,0.07)'
                        : isThisMonth
                          ? '#1E1E28'
                          : '#16161C',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      (e.currentTarget as HTMLElement).style.background = isToday
                        ? 'rgba(56,132,255,0.14)'
                        : isThisMonth
                          ? '#262634'
                          : '#1C1C24'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      (e.currentTarget as HTMLElement).style.background = isToday
                        ? 'rgba(56,132,255,0.07)'
                        : isThisMonth
                          ? '#1E1E28'
                          : '#16161C'
                  }}
                >
                  {/* Day number */}
                  <div
                    className="h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold mb-1.5"
                    style={
                      isToday
                        ? {
                            background: '#3884FF',
                            color: '#fff',
                            boxShadow: '0 0 12px rgba(56,132,255,0.6)',
                          }
                        : isSelected
                          ? { color: '#63B3FF', background: 'rgba(56,132,255,0.18)' }
                          : { color: isThisMonth ? '#D8D8E8' : '#3A3A4A' }
                    }
                  >
                    {format(day, 'd')}
                  </div>

                  {/* Appointment chips */}
                  {hasApts && (
                    <div className="space-y-0.5">
                      {apts.slice(0, 3).map((apt) => (
                        <div
                          key={apt.id}
                          className="w-full rounded-md px-1.5 py-1 text-[10px] font-bold truncate leading-tight"
                          style={{
                            background: `${STATUS_COLORS[apt.status ?? 'pending'] ?? '#3884FF'}28`,
                            color: STATUS_COLORS[apt.status ?? 'pending'] ?? '#63B3FF',
                            border: `1px solid ${STATUS_COLORS[apt.status ?? 'pending'] ?? '#3884FF'}50`,
                            borderLeftWidth: '2px',
                            borderLeftColor: STATUS_COLORS[apt.status ?? 'pending'] ?? '#3884FF',
                          }}
                        >
                          {apt.client?.name?.split(' ')[0]}
                        </div>
                      ))}
                      {apts.length > 3 && (
                        <div className="text-[9px] font-bold px-1 mt-0.5" style={{ color: '#6A6A72' }}>
                          +{apts.length - 3} más
                        </div>
                      )}
                    </div>
                  )}

                  {/* Selected indicator dot */}
                  {isSelected && (
                    <div
                      className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
                      style={{ background: '#0062FF', boxShadow: '0 0 6px rgba(0,98,255,0.8)' }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export const CalendarGrid = memo(CalendarGridInner)
