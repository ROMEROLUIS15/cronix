'use client'

import { memo } from 'react'
import {
  Plus,
  X,
  Check,
  Pencil,
  Loader2,
  Clock,
  Phone,
  Trash2,
  AlertCircle,
  CalendarDays,
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatTime } from '@/lib/utils'
import { getServiceNames } from '@/lib/utils/appointment-services'
import type { AppointmentWithRelations } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFD60A',
  confirmed: '#0062FF',
  completed: '#30D158',
  cancelled: '#FF3B30',
  no_show: '#8A8A90',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No show',
}

interface DayPanelProps {
  selectedDate: Date
  dayApts: AppointmentWithRelations[]
  loading: boolean
  panelOpen: boolean
  dayPanelOpen: boolean
  confirmDelete: string | null
  deletingId: string | null
  supabase: SupabaseClient
  onClose: () => void
  onAptClick: (apt: AppointmentWithRelations) => void
  onDeleteApt: (id: string) => void
  onConfirmDeleteToggle: (id: string | null) => void
  onQuickConfirm: (aptId: string) => void
}

function DayPanelInner({
  selectedDate,
  dayApts,
  loading,
  panelOpen,
  dayPanelOpen,
  confirmDelete,
  deletingId,
  onClose,
  onAptClick,
  onDeleteApt,
  onConfirmDeleteToggle,
  onQuickConfirm,
}: DayPanelProps) {
  return (
    <div
      className={[
        'fixed inset-x-0 bottom-0 z-40 flex flex-col transition-transform duration-300 rounded-t-3xl',
        'lg:inset-x-auto lg:right-0 lg:top-0 lg:h-full lg:rounded-none lg:w-80 xl:w-96',
        dayPanelOpen && !panelOpen
          ? 'translate-y-0 lg:translate-y-0 lg:translate-x-0'
          : 'translate-y-full lg:translate-y-0 lg:translate-x-full',
        panelOpen ? 'invisible' : 'visible',
      ].join(' ')}
      style={{
        background: '#0C0C0F',
        borderTop: '1px solid #262629',
        borderLeft: '1px solid #262629',
        maxHeight: '90dvh',
      }}
    >
      {/* Drag handle — mobile only */}
      <div className="lg:hidden">
        <div className="bottom-sheet-handle" />
      </div>
      {!panelOpen && (
        <>
          {/* Day panel header */}
          <div
            className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{ borderBottom: '1px solid #262629' }}
          >
            <div>
              <p
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: '#0062FF' }}
              >
                Citas del día
              </p>
              <p
                className="text-lg font-black mt-0.5 capitalize"
                style={{ color: '#F5F5F5', letterSpacing: '-0.02em' }}
              >
                {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/appointments/new?date=${format(selectedDate, 'yyyy-MM-dd')}`}
                className="p-2 rounded-xl transition-colors"
                style={{ background: 'rgba(0,98,255,0.1)', color: '#0062FF' }}
                title="Nueva cita"
              >
                <Plus size={18} />
              </Link>
              <button
                onClick={onClose}
                className="p-2 rounded-xl transition-colors hover:bg-white/5"
                style={{ color: '#8A8A90' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Day appointments list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center items-center h-40">
                <Loader2 size={24} className="animate-spin" style={{ color: '#0062FF' }} />
              </div>
            ) : dayApts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 px-6">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    background: 'rgba(0,98,255,0.08)',
                    border: '1px solid rgba(0,98,255,0.15)',
                  }}
                >
                  <CalendarDays size={24} style={{ color: '#0062FF' }} />
                </div>
                <p className="text-sm font-bold mb-1" style={{ color: '#F5F5F5' }}>
                  Sin citas
                </p>
                <p className="text-xs text-center mb-4" style={{ color: '#8A8A90' }}>
                  No hay citas agendadas para este día
                </p>
                <Link
                  href={`/dashboard/appointments/new?date=${format(selectedDate, 'yyyy-MM-dd')}`}
                  className="btn-primary text-xs px-4 py-2 rounded-xl flex items-center gap-2"
                >
                  <Plus size={14} /> Agendar cita
                </Link>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {dayApts.map((apt) => (
                  <div
                    key={apt.id}
                    className="rounded-2xl overflow-hidden transition-all duration-200"
                    style={{
                      background: '#141417',
                      border: `1px solid ${STATUS_COLORS[apt.status ?? 'pending'] ?? '#262629'}40`,
                      borderLeft: `3px solid ${STATUS_COLORS[apt.status ?? 'pending'] ?? '#0062FF'}`,
                    }}
                  >
                    {/* Confirm delete overlay */}
                    {confirmDelete === apt.id ? (
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle size={16} style={{ color: '#FF3B30' }} />
                          <p className="text-sm font-bold" style={{ color: '#F5F5F5' }}>
                            ¿Cancelar esta cita?
                          </p>
                        </div>
                        <p className="text-xs mb-4" style={{ color: '#8A8A90' }}>
                          Esta acción marcará la cita como cancelada.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => onConfirmDeleteToggle(null)}
                            className="flex-1 py-2 rounded-xl text-xs font-bold transition-colors"
                            style={{
                              background: '#1E1E21',
                              color: '#F5F5F5',
                              border: '1px solid #262629',
                            }}
                          >
                            No, volver
                          </button>
                          <button
                            onClick={() => onDeleteApt(apt.id)}
                            disabled={deletingId === apt.id}
                            className="flex-1 py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1"
                            style={{
                              background: 'rgba(255,59,48,0.1)',
                              color: '#FF3B30',
                              border: '1px solid rgba(255,59,48,0.2)',
                            }}
                          >
                            {deletingId === apt.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <>
                                <Trash2 size={12} /> Cancelar cita
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <button className="w-full p-4 text-left" onClick={() => onAptClick(apt)}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate" style={{ color: '#F5F5F5' }}>
                                {apt.client?.name}
                              </p>
                              <p className="text-xs truncate" style={{ color: '#8A8A90' }}>
                                {getServiceNames(apt)}
                              </p>
                            </div>
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                              style={{
                                background: `${STATUS_COLORS[apt.status ?? 'pending']}22`,
                                color: STATUS_COLORS[apt.status ?? 'pending'],
                              }}
                            >
                              {STATUS_LABELS[apt.status ?? 'pending']}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className="flex items-center gap-1 text-[11px]"
                              style={{ color: '#8A8A90' }}
                            >
                              <Clock size={11} />
                              {formatTime(apt.start_at)} – {formatTime(apt.end_at)}
                            </span>
                            {apt.client?.phone && (
                              <span
                                className="flex items-center gap-1 text-[11px]"
                                style={{ color: '#8A8A90' }}
                              >
                                <Phone size={11} /> {apt.client.phone}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Quick actions row */}
                        <div className="flex items-center gap-1 px-3 pb-3">
                          <Link
                            href={`/dashboard/appointments/${apt.id}/edit`}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                            style={{
                              background: 'rgba(0,98,255,0.08)',
                              color: '#4D83FF',
                              border: '1px solid rgba(0,98,255,0.15)',
                            }}
                          >
                            <Pencil size={11} /> Editar
                          </Link>
                          {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onQuickConfirm(apt.id)
                              }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                              style={{
                                background: 'rgba(48,209,88,0.08)',
                                color: '#30D158',
                                border: '1px solid rgba(48,209,88,0.15)',
                              }}
                            >
                              <Check size={11} /> Confirmar
                            </button>
                          )}
                          {apt.status !== 'cancelled' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onConfirmDeleteToggle(apt.id)
                              }}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{
                                background: 'rgba(255,59,48,0.08)',
                                color: '#FF3B30',
                                border: '1px solid rgba(255,59,48,0.15)',
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export const DayPanel = memo(DayPanelInner)
