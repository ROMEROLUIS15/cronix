'use client'

/**
 * usePwaUpdate — Detects a new Service Worker waiting to activate.
 *
 * Flow:
 *  1. On mount, checks for an already-waiting SW (user had the app open
 *     before the new version downloaded).
 *  2. Listens for `updatefound` → waits for the new SW to reach `waiting`
 *     state → sets `updateAvailable = true`.
 *  3. `applyUpdate()` sends SKIP_WAITING to the waiting SW, which triggers
 *     a `controllerchange` event → page reloads automatically.
 *
 * Why not skipWaiting in next.config.js?
 *   skipWaiting: true activates the new SW immediately, interrupting the
 *   user mid-session. This gives the user explicit control.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '@/lib/logger'

export interface PwaUpdateState {
  /** True when a new version is installed and waiting to activate. */
  updateAvailable: boolean
  /** Sends SKIP_WAITING to the waiting SW → page reloads with new version. */
  applyUpdate: () => void
}

export function usePwaUpdate(): PwaUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const waitingWorkerRef = useRef<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let cleanupFn: (() => void) | null = null

    async function setup() {
      try {
        const maybeReg = await navigator.serviceWorker.getRegistration()
        if (!maybeReg) return
        // Re-assign to a non-nullable const so TypeScript preserves the type inside closures
        const registration: ServiceWorkerRegistration = maybeReg

        // Case 1: a new SW is already waiting (e.g. user refreshed after update downloaded)
        if (registration.waiting) {
          waitingWorkerRef.current = registration.waiting
          setUpdateAvailable(true)
        }

        // Case 2: new SW starts installing while the page is open
        let stateChangeCleanup: (() => void) | null = null

        function onUpdateFound() {
          const newWorker = registration.installing
          if (!newWorker) return

          const worker = newWorker
          function onStateChange() {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorkerRef.current = worker
              setUpdateAvailable(true)
            }
          }

          worker.addEventListener('statechange', onStateChange)
          stateChangeCleanup = () => worker.removeEventListener('statechange', onStateChange)
        }

        registration.addEventListener('updatefound', onUpdateFound)

        // Case 3: SW activates (after SKIP_WAITING) → reload to get new assets
        function onControllerChange() {
          window.location.reload()
        }

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

        cleanupFn = () => {
          registration.removeEventListener('updatefound', onUpdateFound)
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
          stateChangeCleanup?.()
        }
      } catch (err) {
        logger.error('PWA-UPDATE', 'Service worker registration error', err)
      }
    }

    setup()

    return () => { cleanupFn?.() }
  }, [])

  const applyUpdate = useCallback(() => {
    const worker = waitingWorkerRef.current
    if (!worker) return
    // Tell the waiting SW to skip the waiting phase and activate immediately
    worker.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  return { updateAvailable, applyUpdate }
}
