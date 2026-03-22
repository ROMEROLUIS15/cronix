'use client'

/**
 * usePwaInstall — Captures the browser's beforeinstallprompt event.
 *
 * Returns:
 *  - canInstall:  true when the browser is ready to show the install dialog
 *                 (Android Chrome / Chromium only — iOS does not support this event)
 *  - install:     triggers the native install dialog
 *  - isInstalled: true when the app is already running as a standalone PWA
 *
 * Lifecycle:
 *  1. Browser fires beforeinstallprompt → we defer it (prevent default)
 *  2. User clicks our button → we call installEvent.prompt()
 *  3. Browser shows native dialog → user accepts or dismisses
 *  4. On accept → isInstalled becomes true, button disappears
 */

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaInstallState {
  canInstall:  boolean
  isInstalled: boolean
  install:     () => Promise<void>
}

export function usePwaInstall(): PwaInstallState {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled,  setIsInstalled]  = useState(false)

  useEffect(() => {
    // Already running as standalone PWA — no need to show the button
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    const handleBeforeInstall = (e: Event) => {
      // Prevent the default mini-infobar so we control when to prompt
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }

    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallEvent(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') {
      setInstallEvent(null)
      setIsInstalled(true)
    }
  }

  return {
    canInstall:  !!installEvent && !isInstalled,
    isInstalled,
    install,
  }
}
