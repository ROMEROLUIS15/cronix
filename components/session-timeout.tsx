'use client'

import { useEffect, useCallback, useRef } from 'react'
import { signout } from '@/app/login/actions'

// ── Constants ──────────────────────────────────────────────────────────────
/** Sign out after 30 min of inactivity */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000

/** Sign out after 12 hours regardless of activity (absolute session limit) */
const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000

const ACTIVITY_EVENTS = [
  'mousemove',
  'keydown',
  'scroll',
  'click',
  'touchstart',
] as const

// ── Component ──────────────────────────────────────────────────────────────
/**
 * Invisible component mounted once in DashboardLayout.
 * Enforces two independent session limits:
 *   1. Inactivity timeout  — signs out after 30min with no user activity
 *   2. Absolute timeout    — signs out after 12h regardless of activity
 */
export function SessionTimeout() {
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absoluteRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetInactivity = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current)
    inactivityRef.current = setTimeout(() => signout(), INACTIVITY_TIMEOUT_MS)
  }, [])

  useEffect(() => {
    // Start inactivity timer
    resetInactivity()

    // Start absolute session timer — fires once, cannot be reset
    absoluteRef.current = setTimeout(() => signout(), ABSOLUTE_TIMEOUT_MS)

    // Reset inactivity timer on any user activity
    ACTIVITY_EVENTS.forEach(event =>
      window.addEventListener(event, resetInactivity, { passive: true })
    )

    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current)
      if (absoluteRef.current)   clearTimeout(absoluteRef.current)
      ACTIVITY_EVENTS.forEach(event =>
        window.removeEventListener(event, resetInactivity)
      )
    }
  }, [resetInactivity])

  return null
}