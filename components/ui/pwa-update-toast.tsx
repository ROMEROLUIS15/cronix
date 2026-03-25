'use client'

import { RefreshCw } from 'lucide-react'
import { usePwaUpdate } from '@/lib/hooks/use-pwa-update'

/**
 * PwaUpdateToast — floating notification when a new app version is ready.
 *
 * Appears bottom-right, only when a new Service Worker is waiting.
 * User clicks "Actualizar" → SW activates → page reloads with new version.
 */
export function PwaUpdateToast() {
  const { updateAvailable, applyUpdate } = usePwaUpdate()

  if (!updateAvailable) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-4 z-50 animate-fade-in"
      style={{ maxWidth: '320px', width: 'calc(100vw - 2rem)' }}
    >
      <div
        className="flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          background:   'rgba(18, 18, 22, 0.97)',
          border:       '1px solid rgba(0, 98, 255, 0.35)',
          boxShadow:    '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 98, 255, 0.1)',
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Icon */}
        <div
          className="flex items-center justify-center flex-shrink-0 h-9 w-9 rounded-xl"
          style={{
            background: 'rgba(0, 98, 255, 0.15)',
            border:     '1px solid rgba(0, 98, 255, 0.3)',
          }}
        >
          <RefreshCw size={16} style={{ color: '#4D83FF' }} />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-bold leading-tight"
            style={{ color: '#F2F2F2' }}
          >
            Nueva versión disponible
          </p>
          <p
            className="text-xs mt-0.5"
            style={{ color: '#8A8A90' }}
          >
            Actualiza para obtener las últimas mejoras
          </p>
        </div>

        {/* Button */}
        <button
          onClick={applyUpdate}
          className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition-all duration-200 active:scale-95 hover:brightness-110"
          style={{
            background:  'rgba(0, 98, 255, 0.9)',
            color:       '#fff',
            border:      '1px solid rgba(0, 98, 255, 0.6)',
            boxShadow:   '0 0 12px rgba(0, 98, 255, 0.4)',
          }}
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
