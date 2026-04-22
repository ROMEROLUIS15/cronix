'use client'

/**
 * usePwaInstall — Manages PWA installation for Chrome/Android and iOS.
 *
 * WHY two capture strategies:
 *   beforeinstallprompt fires once, very early in the page lifecycle —
 *   often BEFORE React mounts. We use two mechanisms in parallel:
 *   1. An inline <script> in app/layout.tsx stores the event in
 *      window.__pwaDeferred before any JS bundle loads.
 *   2. Module-level listeners as a fallback for slower browsers.
 *   On mount, the hook reads whichever stored it first.
 *
 * iOS Safari:
 *   Apple does not implement beforeinstallprompt. We detect iOS and expose
 *   `isIos: true` so the UI can show manual "Add to Home Screen" instructions.
 *
 * Returns:
 *  - canInstall:  true when Chrome/Android is ready to show install dialog
 *  - isIos:       true when running on iOS Safari (needs manual install)
 *  - isInstalled: true when the app is already running as a standalone PWA
 *  - install:     triggers the native install prompt (Chrome/Android only)
 */

import { useState, useEffect, useCallback } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt:     () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Extend Window type for our custom property
declare global {
  interface Window {
    __pwaDeferred?: BeforeInstallPromptEvent
  }
}

// ── Module-level event store ──────────────────────────────────────────────────
// Secondary capture: catches the event if it fires after the bundle loads
// but before the first component mounts.

let _deferred: BeforeInstallPromptEvent | null = null
const _subscribers = new Set<() => void>()

function notifySubscribers() {
  _subscribers.forEach(fn => fn())
}

if (typeof window !== 'undefined') {
  // Sync from the inline <script> capture (may already be set)
  _deferred = window.__pwaDeferred ?? null

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    _deferred = e as BeforeInstallPromptEvent
    window.__pwaDeferred = _deferred
    console.log('[usePwaInstall] beforeinstallprompt captured')
    notifySubscribers()
  })

  window.addEventListener('appinstalled', () => {
    _deferred = null
    window.__pwaDeferred = undefined
    console.log('[usePwaInstall] app installed')
    notifySubscribers()
  })
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface PwaInstallState {
  canInstall:  boolean
  isIos:       boolean
  isInstalled: boolean
  install:     () => Promise<void>
}

export function usePwaInstall(): PwaInstallState {
  const [isInstalled, setIsInstalled] = useState(false)
  const [hasEvent,    setHasEvent]    = useState(false)
  const [isIos,       setIsIos]       = useState(false)

  useEffect(() => {
    // Detect iOS (Apple does not support beforeinstallprompt)
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIos(ios)

    // Check standalone mode on mount
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    // Sync with both capture sources
    const deferred = window.__pwaDeferred ?? _deferred ?? null
    if (deferred && !_deferred) _deferred = deferred

    // Fallback: check for PWA manifest (always show for non-iOS if manifest exists)
    const hasManifest = !!document.querySelector('link[rel="manifest"]')

    // Show install button if: has deferred event OR (has manifest AND not iOS)
    const shouldShow = deferred !== null || (hasManifest && !ios)
    setHasEvent(shouldShow)

    // Subscribe to future updates
    const onUpdate = () => {
      const deferred = _deferred
      const shouldShow = deferred !== null || (hasManifest && !ios)
      setHasEvent(shouldShow)
      if (deferred === null && _deferred === null) {
        setIsInstalled(true)
      }
    }

    _subscribers.add(onUpdate)
    return () => { _subscribers.delete(onUpdate) }
  }, [])

  const install = useCallback(async () => {
    console.log('[usePwaInstall] install() called, _deferred:', !!_deferred)

    if (_deferred) {
      try {
        console.log('[usePwaInstall] showing native prompt')
        await _deferred.prompt()
        const { outcome } = await _deferred.userChoice
        console.log('[usePwaInstall] user choice:', outcome)
        if (outcome === 'accepted') {
          _deferred = null
          setHasEvent(false)
          setIsInstalled(true)
        }
      } catch (err) {
        console.error('[usePwaInstall] prompt error:', err)
        notifySubscribers()
      }
    } else {
      // Fallback: if no deferred event, browser may show install UI automatically
      // or user needs to use browser menu. Log this for debugging.
      console.warn('[usePwaInstall] No beforeinstallprompt event available.')
      console.warn('[usePwaInstall] Installation may require:')
      console.warn('  1. Android: Chrome menu > Install app')
      console.warn('  2. iOS: Safari > Share > Add to Home Screen')
      console.warn('[usePwaInstall] Visit the site multiple times to trigger the prompt')

      // Try to check if manifest and SW are properly set up
      const hasManifest = !!document.querySelector('link[rel="manifest"]')
      const swReg = await navigator.serviceWorker?.getRegistration()
      console.log('[usePwaInstall] Manifest:', hasManifest, 'SW:', !!swReg)

      if (hasManifest && swReg) {
        alert('App is ready to install!\n\nAndroid: Use Chrome menu (⋮) > Install app\n\niOS: Tap Share > Add to Home Screen')
      }
    }
  }, [])

  return {
    canInstall:  hasEvent && !isInstalled,
    isIos,
    isInstalled,
    install,
  }
}
