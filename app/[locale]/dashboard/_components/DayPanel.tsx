"use client"

import Link from "next/link"
import { format }  from "date-fns"
import { es }      from "date-fns/locale"
import { X, Plus, CalendarDays, Clock, Phone, Pencil, Check, Trash2, AlertCircle, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { getStatusColor } from "../_constants"
import { formatTime } from "@/lib/utils"
import type { AppointmentWithRelations } from "@/types"

interface DayPanelProps {
  isOpen:         boolean
  aptPanelOpen:   boolean
  selectedDate:   Date
  dayApts:        AppointmentWithRelations[]
  loading:        boolean
  updatingStatus: boolean
  deletingId:     string | null
  confirmDelete:  string | null
  onClose:          () => void
  onAptClick:       (apt: AppointmentWithRelations) => void
  onConfirmDelete:  (id: string | null) => void
  onDeleteApt:      (id: string) => Promise<void>
  onQuickConfirm:   (aptId: string) => Promise<void>
}

/**
 * DayPanel — Slide-in panel listing all appointments for a selected day.
 * Mobile: bottom sheet. Desktop lg+: right drawer.
 */
export function DayPanel({
  isOpen, aptPanelOpen, selectedDate, dayApts, loading,
  updatingStatus, deletingId, confirmDelete,
  onClose, onAptClick, onConfirmDelete, onDeleteApt, onQuickConfirm,
}: DayPanelProps) {
  const t = useTranslations('dashboard')

  const translateClass = isOpen && !aptPanelOpen
    ? "translate-y-0 lg:translate-y-0 lg:translate-x-0"
    : "translate-y-full lg:translate-y-0 lg:translate-x-full"

  return (
    <div
      className={[
        "fixed inset-x-0 bottom-0 z-40 flex flex-col transition-transform duration-300 rounded-t-3xl",
        "lg:inset-x-auto lg:right-0 lg:top-0 lg:h-full lg:rounded-none lg:w-80 xl:w-96",
        translateClass,
        aptPanelOpen ? "invisible" : "visible",
      ].join(" ")}
      style={{ background: "#0C0C0F", borderTop: "1px solid #262629", borderLeft: "1px solid #262629", maxHeight: "90dvh" }}
    >
      {/* Drag handle — mobile only */}
      <div className="lg:hidden"><div className="bottom-sheet-handle" /></div>

      {!aptPanelOpen && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #262629" }}>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#0062FF" }}>
                {t('panels.dayAppointments')}
              </p>
              <p className="text-lg font-black mt-0.5 capitalize" style={{ color: "#F5F5F5", letterSpacing: "-0.02em" }}>
                {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/appointments/new?date=${format(selectedDate, "yyyy-MM-dd")}`}
                className="p-2 rounded-xl transition-colors"
                style={{ background: "rgba(0,98,255,0.1)", color: "#0062FF" }}
                title="Nueva cita"
              >
                <Plus size={18} />
              </Link>
              <button onClick={onClose} className="p-2 rounded-xl transition-colors hover:bg-white/5" style={{ color: "#8A8A90" }}>
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center items-center h-40">
                <Loader2 size={24} className="animate-spin" style={{ color: "#0062FF" }} />
              </div>
            ) : dayApts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 px-6">
                <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(0,98,255,0.08)", border: "1px solid rgba(0,98,255,0.15)" }}>
                  <CalendarDays size={24} style={{ color: "#0062FF" }} />
                </div>
                <p className="text-sm font-bold mb-1" style={{ color: "#F5F5F5" }}>{t('panels.noAppointments')}</p>
                <p className="text-xs text-center mb-4" style={{ color: "#8A8A90" }}>{t('panels.noAppointmentsDesc')}</p>
                <Link
                  href={`/dashboard/appointments/new?date=${format(selectedDate, "yyyy-MM-dd")}`}
                  className="btn-primary text-xs px-4 py-2 rounded-xl flex items-center gap-2"
                >
                  <Plus size={14} /> {t('panels.scheduleAppointment')}
                </Link>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {dayApts.map(apt => {
                  const statusColor = getStatusColor(apt.status)
                  return (
                    <div
                      key={apt.id}
                      className="rounded-2xl overflow-hidden transition-all duration-200"
                      style={{
                        background:  "#141417",
                        border:      `1px solid ${statusColor}40`,
                        borderLeft:  `3px solid ${statusColor}`,
                      }}
                    >
                      {/* Confirm delete overlay */}
                      {confirmDelete === apt.id ? (
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <AlertCircle size={16} style={{ color: "#FF3B30" }} />
                            <p className="text-sm font-bold" style={{ color: "#F5F5F5" }}>{t('panels.cancelQuestion')}</p>
                          </div>
                          <p className="text-xs mb-4" style={{ color: "#8A8A90" }}>{t('panels.cancelDesc')}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => onConfirmDelete(null)}
                              className="flex-1 py-2 rounded-xl text-xs font-bold"
                              style={{ background: "#1E1E21", color: "#F5F5F5", border: "1px solid #262629" }}
                            >
                              {t('panels.cancelNo')}
                            </button>
                            <button
                              onClick={() => onDeleteApt(apt.id)}
                              disabled={deletingId === apt.id}
                              className="flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1"
                              style={{ background: "rgba(255,59,48,0.1)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.2)" }}
                            >
                              {deletingId === apt.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <><Trash2 size={12} /> {t('panels.cancelYes')}</>}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <button className="w-full p-4 text-left" onClick={() => onAptClick(apt)}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold truncate" style={{ color: "#F5F5F5" }}>{apt.client?.name}</p>
                                <p className="text-xs truncate" style={{ color: "#8A8A90" }}>{apt.service?.name}</p>
                              </div>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: `${statusColor}22`, color: statusColor }}>
                                ● {apt.status === "pending" ? t('status.pending')
                                  : apt.status === "confirmed" ? t('status.confirmed')
                                  : apt.status === "completed" ? t('status.completed')
                                  : apt.status === "cancelled" ? t('status.cancelled')
                                  : t('status.noShow')}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="flex items-center gap-1 text-[11px]" style={{ color: "#8A8A90" }}>
                                <Clock size={11} /> {formatTime(apt.start_at)} – {formatTime(apt.end_at)}
                              </span>
                              {apt.client?.phone && (
                                <span className="flex items-center gap-1 text-[11px]" style={{ color: "#8A8A90" }}>
                                  <Phone size={11} /> {apt.client.phone}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Quick actions */}
                          <div className="flex items-center gap-1 px-3 pb-3">
                            <Link
                              href={`/dashboard/appointments/${apt.id}/edit`}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold"
                              style={{ background: "rgba(0,98,255,0.08)", color: "#4D83FF", border: "1px solid rgba(0,98,255,0.15)" }}
                            >
                              <Pencil size={11} /> {t('panels.edit')}
                            </Link>

                            {apt.status !== "completed" && apt.status !== "cancelled" && (
                              <button
                                onClick={async e => { e.stopPropagation(); await onQuickConfirm(apt.id) }}
                                disabled={updatingStatus}
                                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-50"
                                style={{ background: "rgba(48,209,88,0.08)", color: "#30D158", border: "1px solid rgba(48,209,88,0.15)" }}
                              >
                                <Check size={11} /> {t('panels.confirm')}
                              </button>
                            )}

                            {apt.status !== "cancelled" && (
                              <button
                                onClick={e => { e.stopPropagation(); onConfirmDelete(apt.id) }}
                                className="p-1.5 rounded-lg"
                                style={{ background: "rgba(255,59,48,0.08)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.15)" }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
