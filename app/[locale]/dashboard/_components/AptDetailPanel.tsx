"use client"

import Link from "next/link"
import { X, Pencil, Check, Ban, Clock, Phone, User, Loader2, Printer } from "lucide-react"
import { useTranslations } from "next-intl"
import { getStatusColor } from "../_constants"
import { formatTime, formatCurrency } from "@/lib/utils"
import { downloadElementAsPDF } from "@/lib/utils/pdf-generator"
import type { AppointmentStatus, AppointmentWithRelations } from "@/types"

interface AptDetailPanelProps {
  isOpen:         boolean
  apt:            AppointmentWithRelations | null
  updatingStatus: boolean
  actionError:    string | null
  onClose:        () => void
  onStatusChange: (status: AppointmentStatus) => Promise<void>
  onClearError:   () => void
}

/**
 * AptDetailPanel — Full detail view for a selected appointment.
 * Mobile: bottom sheet (z-50). Desktop lg+: right drawer above DayPanel.
 */
export function AptDetailPanel({
  isOpen, apt, updatingStatus, actionError,
  onClose, onStatusChange, onClearError,
}: AptDetailPanelProps) {
  const t = useTranslations('dashboard')

  const translateClass = isOpen
    ? "translate-y-0 lg:translate-y-0 lg:translate-x-0"
    : "translate-y-full lg:translate-y-0 lg:translate-x-full"

  const statusColor = getStatusColor(apt?.status)

  const statusLabel = (s: string | null | undefined) => {
    if (s === "pending")   return `● ${t('status.pending')}`
    if (s === "confirmed") return `● ${t('status.confirmed')}`
    if (s === "completed") return `● ${t('status.completed')}`
    if (s === "cancelled") return `● ${t('status.cancelled')}`
    return `● ${t('status.noShow')}`
  }

  return (
    <div
      id="ticket-to-print"
      className={[
        "fixed inset-x-0 bottom-0 z-50 flex flex-col transition-transform duration-300 rounded-t-3xl",
        "lg:inset-x-auto lg:right-0 lg:top-0 lg:h-full lg:rounded-none lg:w-80 xl:w-96",
        translateClass,
      ].join(" ")}
      style={{ background: "#0C0C0F", borderTop: "1px solid #262629", borderLeft: "1px solid #262629", maxHeight: "90dvh" }}
    >
      {/* Drag handle — mobile only */}
      <div className="lg:hidden"><div className="bottom-sheet-handle" /></div>

      {apt && (
        <>
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{ borderBottom: "1px solid #262629", borderTop: `3px solid ${statusColor}` }}
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#8A8A90" }}>
                {t('panels.detailTitle')}
              </p>
              <p className="text-base font-black mt-0.5" style={{ color: "#F5F5F5" }}>
                {apt.client?.name}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 transition-colors" style={{ color: "#8A8A90" }}>
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Status + price */}
            <div className="flex items-center justify-between">
              <span className="badge" style={{
                background: `${statusColor}20`,
                color:       statusColor,
                border:     `1px solid ${statusColor}30`,
              }}>
                {statusLabel(apt.status)}
              </span>
              <span className="text-base font-black" style={{ color: "#F5F5F5" }}>
                {formatCurrency(apt.service?.price ?? 0)}
              </span>
            </div>

            {/* Detail rows */}
            <div className="space-y-0">
              {[
                { label: t('panels.service'),  value: apt.service?.name,                                                icon: <User  size={13} /> },
                { label: t('panels.time'),     value: `${formatTime(apt.start_at)} – ${formatTime(apt.end_at)}`,       icon: <Clock size={13} /> },
                { label: t('panels.duration'), value: `${apt.service?.duration_min} min`,                               icon: <Clock size={13} /> },
                { label: t('panels.staff'),    value: apt.assigned_user?.name ?? t('panels.unassigned'),               icon: <User  size={13} /> },
                { label: t('panels.phone'),    value: apt.client?.phone ?? "—",                                        icon: <Phone size={13} /> },
              ].map(({ label, value, icon }) => (
                <div key={label} className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid #262629" }}>
                  <span className="flex items-center gap-2 text-xs font-medium" style={{ color: "#8A8A90" }}>
                    {icon} {label}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: "#F5F5F5" }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Notes */}
            {apt.notes && (
              <div className="p-3 rounded-xl" style={{ background: "#1E1E21", border: "1px solid #262629" }}>
                <p className="text-xs font-bold mb-1" style={{ color: "#8A8A90" }}>{t('panels.notes')}</p>
                <p className="text-sm" style={{ color: "#F5F5F5" }}>{apt.notes}</p>
              </div>
            )}

            {/* Status actions */}
            {apt.status !== "completed" && apt.status !== "cancelled" && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#8A8A90" }}>
                  {t('panels.changeStatus')}
                </p>
                <div className="space-y-2">
                  {actionError && (
                    <p className="text-xs px-1 py-1.5 text-center rounded-lg"
                      style={{ color: "#FF3B30", background: "rgba(255,59,48,0.08)" }}>
                      {actionError}
                    </p>
                  )}

                  {apt.status !== "confirmed" && (
                    <button
                      onClick={() => { onClearError(); onStatusChange("confirmed") }}
                      disabled={updatingStatus}
                      className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                      style={{ background: "rgba(0,98,255,0.1)", color: "#4D83FF", border: "1px solid rgba(0,98,255,0.2)" }}
                    >
                      <Check size={15} /> {t('panels.confirmApt')}
                    </button>
                  )}

                  <button
                    onClick={() => onStatusChange("completed")}
                    disabled={updatingStatus}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: "rgba(48,209,88,0.1)", color: "#30D158", border: "1px solid rgba(48,209,88,0.2)" }}
                  >
                    <Check size={15} /> {t('panels.markCompleted')}
                  </button>

                  <button
                    onClick={() => onStatusChange("cancelled")}
                    disabled={updatingStatus}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: "rgba(255,59,48,0.1)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.2)" }}
                  >
                    <Ban size={15} /> {t('panels.cancelApt')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 space-y-2 flex-shrink-0" style={{ borderTop: "1px solid #262629" }}>
            <button
              onClick={() => {
                const docName = `Recibo_${apt.client?.name?.replace(/\s+/g, '_') ?? 'Cita'}.pdf`
                downloadElementAsPDF('ticket-to-print', docName)
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
              style={{ background: "#262629", color: "#F5F5F5", border: "1px solid #3F3F46" }}
            >
              <Printer size={15} /> Descargar Recibo PDF
            </button>
            <Link
              href={`/dashboard/appointments/${apt.id}/edit`}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: "#0062FF", color: "#fff" }}
            >
              <Pencil size={15} /> {t('panels.editFullApt')}
            </Link>
            <button
              onClick={onClose}
              className="w-full py-2 text-xs font-bold rounded-xl"
              style={{ color: "#8A8A90" }}
            >
              {t('panels.backToDay')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
