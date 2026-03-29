'use client'

import { memo } from 'react'
import { X, Check, Ban, Pencil, Clock, Phone, User } from 'lucide-react'
import Link from 'next/link'
import { formatCurrency, formatTime } from '@/lib/utils'
import { getServices, getServiceNames, getTotalDuration, getTotalPrice } from '@/lib/utils/appointment-services'
import type { AppointmentStatus, AppointmentWithRelations } from '@/types'

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFD60A',
  confirmed: '#0062FF',
  completed: '#30D158',
  cancelled: '#FF3B30',
  no_show: '#8A8A90',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '● Pendiente',
  confirmed: '● Confirmada',
  completed: '● Completada',
  cancelled: '● Cancelada',
  no_show: '● No show',
}

interface AppointmentDetailPanelProps {
  selectedApt: AppointmentWithRelations | null
  panelOpen: boolean
  updatingStatus: boolean
  actionError: string | null
  onClose: () => void
  onUpdateStatus: (status: AppointmentStatus) => void
  onClearError: () => void
}

function AppointmentDetailPanelInner({
  selectedApt,
  panelOpen,
  updatingStatus,
  actionError,
  onClose,
  onUpdateStatus,
  onClearError,
}: AppointmentDetailPanelProps) {
  return (
    <div
      className={[
        'fixed inset-x-0 bottom-0 z-50 flex flex-col transition-transform duration-300 rounded-t-3xl',
        'lg:inset-x-auto lg:right-0 lg:top-0 lg:h-full lg:rounded-none lg:w-80 xl:w-96',
        panelOpen
          ? 'translate-y-0 lg:translate-y-0 lg:translate-x-0'
          : 'translate-y-full lg:translate-y-0 lg:translate-x-full',
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
      {selectedApt && (
        <>
          <div
            className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{
              borderBottom: '1px solid #262629',
              borderTop: `3px solid ${STATUS_COLORS[selectedApt.status ?? ''] ?? '#0062FF'}`,
            }}
          >
            <div>
              <p
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: '#8A8A90' }}
              >
                Detalle de cita
              </p>
              <p className="text-base font-black mt-0.5" style={{ color: '#F5F5F5' }}>
                {selectedApt.client?.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-white/5 transition-colors"
              style={{ color: '#8A8A90' }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Status + price */}
            <div className="flex items-center justify-between">
              <span
                className="badge"
                style={{
                  background: `${STATUS_COLORS[selectedApt.status ?? ''] ?? '#0062FF'}20`,
                  color: STATUS_COLORS[selectedApt.status ?? ''] ?? '#0062FF',
                  border: `1px solid ${STATUS_COLORS[selectedApt.status ?? ''] ?? '#0062FF'}30`,
                }}
              >
                {STATUS_LABELS[selectedApt.status ?? 'pending']}
              </span>
              <span className="text-base font-black" style={{ color: '#F5F5F5' }}>
                {formatCurrency(getTotalPrice(selectedApt))}
              </span>
            </div>

            {/* Details */}
            <div className="space-y-0">
              {[
                {
                  label: getServices(selectedApt).length > 1 ? 'Servicios' : 'Servicio',
                  value: getServiceNames(selectedApt),
                  icon: <User size={13} />,
                },
                {
                  label: 'Hora',
                  value: `${formatTime(selectedApt.start_at)} – ${formatTime(selectedApt.end_at)}`,
                  icon: <Clock size={13} />,
                },
                {
                  label: 'Duración',
                  value: `${getTotalDuration(selectedApt)} min`,
                  icon: <Clock size={13} />,
                },
                {
                  label: 'Empleado',
                  value: selectedApt.assigned_user?.name ?? 'Sin asignar',
                  icon: <User size={13} />,
                },
                {
                  label: 'Teléfono',
                  value: selectedApt.client?.phone ?? '—',
                  icon: <Phone size={13} />,
                },
              ].map(({ label, value, icon }) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: '1px solid #262629' }}
                >
                  <span
                    className="flex items-center gap-2 text-xs font-medium"
                    style={{ color: '#8A8A90' }}
                  >
                    {icon} {label}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: '#F5F5F5' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {selectedApt.notes && (
              <div
                className="p-3 rounded-xl"
                style={{ background: '#1E1E21', border: '1px solid #262629' }}
              >
                <p className="text-xs font-bold mb-1" style={{ color: '#8A8A90' }}>
                  Notas
                </p>
                <p className="text-sm" style={{ color: '#F5F5F5' }}>
                  {selectedApt.notes}
                </p>
              </div>
            )}

            {/* Status actions */}
            {selectedApt.status !== 'completed' && selectedApt.status !== 'cancelled' && (
              <div className="space-y-2">
                <p
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: '#8A8A90' }}
                >
                  Cambiar estado
                </p>
                <div className="space-y-2">
                  {actionError && (
                    <p
                      className="text-xs px-1 py-1.5 text-center rounded-lg"
                      style={{ color: '#FF3B30', background: 'rgba(255,59,48,0.08)' }}
                    >
                      {actionError}
                    </p>
                  )}
                  {selectedApt.status !== 'confirmed' && (
                    <button
                      onClick={() => {
                        onClearError()
                        onUpdateStatus('confirmed')
                      }}
                      disabled={updatingStatus}
                      className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                      style={{
                        background: 'rgba(0,98,255,0.1)',
                        color: '#4D83FF',
                        border: '1px solid rgba(0,98,255,0.2)',
                      }}
                    >
                      <Check size={15} /> Confirmar cita
                    </button>
                  )}
                  <button
                    onClick={() => onUpdateStatus('completed')}
                    disabled={updatingStatus}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                    style={{
                      background: 'rgba(48,209,88,0.1)',
                      color: '#30D158',
                      border: '1px solid rgba(48,209,88,0.2)',
                    }}
                  >
                    <Check size={15} /> Marcar completada
                  </button>
                  <button
                    onClick={() => onUpdateStatus('cancelled')}
                    disabled={updatingStatus}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                    style={{
                      background: 'rgba(255,59,48,0.1)',
                      color: '#FF3B30',
                      border: '1px solid rgba(255,59,48,0.2)',
                    }}
                  >
                    <Ban size={15} /> Cancelar cita
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 space-y-2 flex-shrink-0" style={{ borderTop: '1px solid #262629' }}>
            <Link
              href={`/dashboard/appointments/${selectedApt.id}/edit`}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors"
              style={{ background: '#0062FF', color: '#fff' }}
            >
              <Pencil size={15} /> Editar cita completa
            </Link>
            <button
              onClick={onClose}
              className="w-full py-2 text-xs font-bold transition-colors rounded-xl"
              style={{ color: '#8A8A90' }}
            >
              ← Volver al día
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export const AppointmentDetailPanel = memo(AppointmentDetailPanelInner)
