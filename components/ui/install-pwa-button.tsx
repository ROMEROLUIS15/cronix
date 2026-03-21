'use client'

/**
 * InstallPwaButton — One-tap PWA installation button.
 *
 * Renders only when:
 *  - The browser supports beforeinstallprompt (Android Chrome / Chromium)
 *  - The PWA is NOT already installed
 *
 * On iOS Safari the button never renders — iOS requires "Add to Home Screen"
 * from the Share menu (Apple does not support beforeinstallprompt).
 */

import { Download } from 'lucide-react'
import { usePwaInstall } from '@/lib/hooks/use-pwa-install'

export function InstallPwaButton() {
  const { canInstall, install } = usePwaInstall()

  if (!canInstall) return null

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
