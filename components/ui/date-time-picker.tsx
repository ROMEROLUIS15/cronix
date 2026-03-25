'use client'

/**
 * DateTimePicker — Custom date + time picker, consistent across iOS/Android/desktop.
 *
 * Replaces <input type="datetime-local"> which renders differently per platform.
 * Opens a bottom-sheet on mobile, centered modal on desktop.
 *
 * Value format: "YYYY-MM-DDTHH:mm" (same as datetime-local)
 */

import { useState, useEffect, useCallback } from 'react'
import { DayPicker } from 'react-day-picker'
import { format, isValid, parse } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Check, X } from 'lucide-react'
import 'react-day-picker/dist/style.css'

interface Props {
  value: string                    // "YYYY-MM-DDTHH:mm"
  onChange: (v: string) => void
  min?: string                     // "YYYY-MM-DDTHH:mm"
  required?: boolean
}

function pad(n: number) { return String(n).padStart(2, '0') }

function parseValue(v: string): { date: Date | undefined; hour: number; minute: number; period: 'AM' | 'PM' } {
  if (!v) return { date: undefined, hour: 12, minute: 0, period: 'AM' }
  const d = new Date(v.length === 16 ? v + ':00' : v)
  if (!isValid(d)) return { date: undefined, hour: 12, minute: 0, period: 'AM' }
  const h24 = d.getHours()
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
  return { date: d, hour, minute: d.getMinutes(), period: h24 >= 12 ? 'PM' : 'AM' }
}

function toDatetimeLocal(date: Date, hour: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  const d = new Date(date)
  d.setHours(h, minute, 0, 0)
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

const HOURS   = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

export function DateTimePicker({ value, onChange, min, required }: Props) {
  const parsed = parseValue(value)
  const [open,     setOpen]     = useState(false)
  const [selDate,  setSelDate]  = useState<Date | undefined>(parsed.date)
  const [hour,     setHour]     = useState(parsed.hour)
  const [minute,   setMinute]   = useState(parsed.minute)
  const [period,   setPeriod]   = useState<'AM' | 'PM'>(parsed.period)

  // Sync internal state when value changes externally
  useEffect(() => {
    const p = parseValue(value)
    setSelDate(p.date)
    setHour(p.hour)
    setMinute(p.minute)
    setPeriod(p.period)
  }, [value])

  const minDate = min ? new Date(min) : new Date()

  const handleConfirm = useCallback(() => {
    if (!selDate) return
    onChange(toDatetimeLocal(selDate, hour, minute, period))
    setOpen(false)
  }, [selDate, hour, minute, period, onChange])

  const handleOpen = () => {
    // Reset to current value when opening
    const p = parseValue(value)
    setSelDate(p.date)
    setHour(p.hour)
    setMinute(p.minute)
    setPeriod(p.period)
    setOpen(true)
  }

  // Display label
  const display = (() => {
    if (!value) return ''
    const d = new Date(value.length === 16 ? value + ':00' : value)
    if (!isValid(d)) return ''
    const h = d.getHours()
    const hr = h === 0 ? 12 : h > 12 ? h - 12 : h
    const mn = d.getMinutes()
    const pd = h >= 12 ? 'p. m.' : 'a. m.'
    const dateStr = format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })
    return `${dateStr} · ${pad(hr)}:${pad(mn)} ${pd}`
  })()

  return (
    <>
      {/* ── Trigger ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleOpen}
        className="input-base w-full text-left flex items-center gap-2.5 min-h-[44px]"
      >
        <CalendarDays size={15} style={{ color: '#606068', flexShrink: 0 }} />
        <span className="truncate" style={{ color: display ? '#F2F2F2' : '#606068', fontSize: '0.875rem' }}>
          {display || 'Seleccionar fecha y hora'}
        </span>
      </button>

      {/* ── Modal ──────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div
            className="relative w-full sm:w-auto z-10 rounded-t-3xl sm:rounded-2xl overflow-hidden"
            style={{
              background:   '#1C1C1E',
              border:       '1px solid rgba(255,255,255,0.08)',
              boxShadow:    '0 -8px 40px rgba(0,0,0,0.6)',
              maxWidth:     '400px',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <p className="text-base font-semibold" style={{ color: '#F2F2F2' }}>
                Fecha y hora
              </p>
              <button
                onClick={() => setOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                <X size={14} style={{ color: '#8A8A90' }} />
              </button>
            </div>

            {/* Calendar */}
            <div className="px-3 pb-1">
              <DayPicker
                mode="single"
                selected={selDate}
                onSelect={setSelDate}
                locale={es}
                fromDate={minDate}
                showOutsideDays={false}
                fixedWeeks
                components={{
                  IconLeft:  () => <ChevronLeft  size={16} style={{ color: '#0062FF' }} />,
                  IconRight: () => <ChevronRight size={16} style={{ color: '#0062FF' }} />,
                }}
                styles={{
                  root:       { width: '100%', fontFamily: 'inherit' },
                  months:     { width: '100%' },
                  month:      { width: '100%' },
                  caption:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px', color: '#F2F2F2', fontWeight: 600, fontSize: '0.9rem', textTransform: 'capitalize' },
                  nav:        { display: 'flex', gap: '4px' },
                  nav_button: { background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '10px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
                  table:      { width: '100%', borderCollapse: 'collapse' },
                  head_row:   { display: 'flex', justifyContent: 'space-around', marginBottom: '4px' },
                  head_cell:  { color: '#606068', fontSize: '0.72rem', fontWeight: 600, width: '36px', textAlign: 'center', textTransform: 'uppercase' },
                  row:        { display: 'flex', justifyContent: 'space-around', marginBottom: '2px' },
                  cell:       { width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
                  day:        { width: '36px', height: '36px', borderRadius: '50%', border: 'none', background: 'transparent', color: '#F2F2F2', cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' },
                }}
                modifiersStyles={{
                  selected: { background: '#0062FF', color: '#fff', fontWeight: 700 },
                  today:    { fontWeight: 700, color: '#0062FF' },
                  disabled: { color: '#3A3A3F', cursor: 'default' },
                  outside:  { color: '#3A3A3F' },
                }}
              />
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0 20px' }} />

            {/* Time picker */}
            <div className="px-5 py-4">
              <p className="text-xs font-semibold mb-3" style={{ color: '#606068', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Hora
              </p>
              <div className="flex items-center gap-2">
                {/* Hours */}
                <div className="flex-1">
                  <select
                    value={hour}
                    onChange={e => setHour(Number(e.target.value))}
                    style={{
                      width: '100%', background: '#2C2C2E', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px', color: '#F2F2F2', fontSize: '1.1rem', fontWeight: 600,
                      padding: '10px 8px', textAlign: 'center', cursor: 'pointer', outline: 'none',
                    }}
                  >
                    {HOURS.map(h => (
                      <option key={h} value={h}>{pad(h)}</option>
                    ))}
                  </select>
                </div>

                <span style={{ color: '#F2F2F2', fontSize: '1.2rem', fontWeight: 700, flexShrink: 0 }}>:</span>

                {/* Minutes */}
                <div className="flex-1">
                  <select
                    value={minute}
                    onChange={e => setMinute(Number(e.target.value))}
                    style={{
                      width: '100%', background: '#2C2C2E', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px', color: '#F2F2F2', fontSize: '1.1rem', fontWeight: 600,
                      padding: '10px 8px', textAlign: 'center', cursor: 'pointer', outline: 'none',
                    }}
                  >
                    {MINUTES.map(m => (
                      <option key={m} value={m}>{pad(m)}</option>
                    ))}
                  </select>
                </div>

                {/* AM/PM */}
                <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                  {(['AM', 'PM'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer',
                        background: period === p ? '#0062FF' : 'rgba(255,255,255,0.06)',
                        color:      period === p ? '#fff'    : '#8A8A90',
                        transition: 'all 0.15s',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 px-5 pb-6">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#8A8A90', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selDate}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                style={{
                  background: selDate ? '#0062FF' : 'rgba(0,98,255,0.3)',
                  color: '#fff',
                  border: '1px solid rgba(0,98,255,0.4)',
                  boxShadow: selDate ? '0 0 16px rgba(0,98,255,0.35)' : 'none',
                }}
              >
                <Check size={16} />
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
