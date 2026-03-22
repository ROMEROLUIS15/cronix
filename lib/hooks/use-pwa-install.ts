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
    notifySubscribers()
  })

  window.addEventListener('appinstalled', () => {
    _deferred = null
    window.__pwaDeferred = undefined
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
  const [hasEvent,    setHasEvent]    = useState(() => _deferred !== null)
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
    setHasEvent(deferred !== null)

    // Subscribe to future updates
    const onUpdate = () => {
      setHasEvent(_deferred !== null)
      if (_deferred === null) setIsInstalled(true)
    }

    _subscribers.add(onUpdate)
    return () => { _subscribers.delete(onUpdate) }
  }, [])

  const install = useCallback(async () => {
    if (!_deferred) return
    await _deferred.prompt()
    const { outcome } = await _deferred.userChoice
    if (outcome === 'accepted') {
      _deferred = null
      setHasEvent(false)
      setIsInstalled(true)
    }
  }, [])

  return {
    canInstall:  hasEvent && !isInstalled,
    isIos,
    isInstalled,
    install,
  }
}
