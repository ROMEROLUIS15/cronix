'use client'

import { useEffect, useCallback, useRef } from 'react'
import { signout } from '@/app/login/actions'

// ── Constants ──────────────────────────────────────────────────────────────
const TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

const ACTIVITY_EVENTS = [
  'mousemove',
  'keydown',
  'scroll',
  'click',
  'touchstart',
] as const

// ── Component ──────────────────────────────────────────────────────────────
/**
 * Invisible component that signs the user out after TIMEOUT_MS of inactivity.
 * Mount once inside DashboardLayout — returns null, renders nothing.
 */
export function SessionTimeout() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => { signout() }, TIMEOUT_MS)
  }, [])

  useEffect(() => {
    // Start the timer immediately on mount
    resetTimeout()

    // Reset on any user activity
    ACTIVITY_EVENTS.forEach(event =>
      window.addEventListener(event, resetTimeout, { passive: true })
    )

    return () => {
      // Cleanup on unmount
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      ACTIVITY_EVENTS.forEach(event =>
        window.removeEventListener(event, resetTimeout)
      )
    }
  }, [resetTimeout])

  return null
}
