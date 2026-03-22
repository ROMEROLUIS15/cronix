'use client'

/**
 * InstallPwaButton — PWA installation button with iOS and Android/Chrome support.
 *
 * Android Chrome / Chromium:
 *   Shows a one-tap install button when beforeinstallprompt is available.
 *
 * iOS Safari:
 *   Apple does not support beforeinstallprompt. Shows a button that opens
 *   a tooltip with step-by-step "Add to Home Screen" instructions.
 *
 * Hidden when:
 *   - The app is already running as a standalone PWA (already installed)
 *   - Neither install prompt nor iOS is detected
 */

import { useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'

export function InstallPwaButton() {
  const { canInstall, isIos, isInstalled, install } = usePwaInstall()
  const [showIosGuide, setShowIosGuide] = useState(false)

  // Already installed — hide
  if (isInstalled) return null

  // Android/Chrome — native install prompt
  if (canInstall) {
    return (
      <button
        onClick={install}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 active:scale-[0.98] hover:brightness-125"
        style={{
          backgroundColor: 'rgba(0,98,255,0.10)',
          color:           '#4D83FF',
          border:          '1px solid rgba(0,98,255,0.25)',
        }}
      >
        <Download size={13} className="flex-shrink-0" />
        <span className="flex-1 text-left">Instalar app</span>
      </button>
    )
  }

  // iOS — manual guide
  if (isIos) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowIosGuide(v => !v)}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 active:scale-[0.98] hover:brightness-125"
          style={{
            backgroundColor: 'rgba(0,98,255,0.10)',
            color:           '#4D83FF',
            border:          '1px solid rgba(0,98,255,0.25)',
          }}
        >
          <Share size={13} className="flex-shrink-0" />
          <span className="flex-1 text-left">Añadir a inicio</span>
        </button>

        {showIosGuide && (
          <div
            className="absolute bottom-full left-0 right-0 mb-2 p-3 rounded-xl text-xs z-50"
            style={{
              background: '#1C1C1F',
              border:     '1px solid rgba(255,255,255,0.1)',
              color:      '#D1D1D6',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold" style={{ color: '#F2F2F2' }}>
                Instalar en iOS
              </span>
              <button onClick={() => setShowIosGuide(false)}>
                <X size={14} style={{ color: '#909098' }} />
              </button>
            </div>
            <ol className="space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <span style={{ color: '#0062FF', fontWeight: 700 }}>1.</span>
                Toca el ícono de compartir <span style={{ color: '#4D83FF' }}>⬆</span> en Safari
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: '#0062FF', fontWeight: 700 }}>2.</span>
                Desplázate y toca <strong style={{ color: '#F2F2F2' }}>&ldquo;Añadir a pantalla de inicio&rdquo;</strong>
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: '#0062FF', fontWeight: 700 }}>3.</span>
                Toca <strong style={{ color: '#F2F2F2' }}>&ldquo;Añadir&rdquo;</strong> para confirmar
              </li>
            </ol>
          </div>
        )}
      </div>
    )
  }

  return null
}
