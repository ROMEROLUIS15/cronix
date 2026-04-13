'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { signout } from '@/lib/actions/auth'

// ── Constants ───────────────────────────────────────────────────────────────
/** Sign out after 30 min of inactivity */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
/** Show warning this many ms before inactivity timeout fires */
const INACTIVITY_WARNING_MS = 2 * 60 * 1000

/** Absolute session limit: 12 hours */
const ABSOLUTE_TIMEOUT_MS   = 12 * 60 * 60 * 1000
/** Show warning this many ms before the absolute limit */
const ABSOLUTE_WARNING_MS   = 10 * 60 * 1000

/** sessionStorage key that persists the login timestamp across page reloads */
const SESSION_START_KEY = 'cronix_session_start'
/** How often to re-check the absolute limit (ms) */
const ABSOLUTE_POLL_MS = 30_000
/** Server ping throttle — max one ping per minute */
const PING_THROTTLE_MS = 60_000

const ACTIVITY_EVENTS = [
  'mousemove', 'mousedown', 'keydown', 'scroll', 'click', 'touchstart',
] as const

// ── Helper ──────────────────────────────────────────────────────────────────
function getOrCreateSessionStart(): number {
  const stored = sessionStorage.getItem(SESSION_START_KEY)
  if (stored) {
    const ts = parseInt(stored, 10)
    if (!isNaN(ts)) return ts
  }
  const now = Date.now()
  sessionStorage.setItem(SESSION_START_KEY, String(now))
  return now
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export type SessionWarningType = 'inactivity' | 'absolute' | null

interface UseSessionTimeoutReturn {
  warning: SessionWarningType
  warningMsLeft: number
  onKeepSession: () => void
  onSignout: () => void
}

export function useSessionTimeout(): UseSessionTimeoutReturn {
  const warningRef              = useRef<SessionWarningType>(null)
  const [warning, _setWarning]  = useState<SessionWarningType>(null)
  const setWarning              = useCallback((w: SessionWarningType) => {
    warningRef.current = w
    _setWarning(w)
  }, [])

  const inactivityRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inactivityWarningRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absolutePollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningShownRef      = useRef<SessionWarningType>(null)
  const lastPingRef          = useRef<number>(0)
  const [warningMsLeft, setWarningMsLeft] = useState(0)

  // ── Sign out ──────────────────────────────────────────────────────────────
  const doSignout = useCallback(async () => {
    sessionStorage.removeItem(SESSION_START_KEY)
    await signout()
  }, [])

  // ── Server ping (throttled) ───────────────────────────────────────────────
  const pingServer = useCallback(async () => {
    const now = Date.now()
    if (now - lastPingRef.current < PING_THROTTLE_MS) return
    lastPingRef.current = now
    try {
      await fetch('/api/activity/ping', { method: 'POST' })
    } catch { /* ignore */ }
  }, [])

  // ── Inactivity timer ─────────────────────────────────────────────────────
  const clearInactivityTimers = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current)
    if (inactivityWarningRef.current) clearTimeout(inactivityWarningRef.current)
  }, [])

  const resetInactivity = useCallback(() => {
    clearInactivityTimers()
    pingServer()

    if (warningRef.current === 'inactivity') {
      setWarning(null)
      warningShownRef.current = null
    }

    inactivityWarningRef.current = setTimeout(() => {
      if (warningShownRef.current !== 'inactivity') {
        warningShownRef.current = 'inactivity'
        setWarningMsLeft(INACTIVITY_WARNING_MS)
        setWarning('inactivity')
      }
    }, INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS)

    inactivityRef.current = setTimeout(() => { doSignout() }, INACTIVITY_TIMEOUT_MS)
  }, [clearInactivityTimers, doSignout, pingServer, setWarning])

  // ── Absolute timer ───────────────────────────────────────────────────────
  const checkAbsoluteLimit = useCallback(() => {
    const sessionStart = getOrCreateSessionStart()
    const elapsed = Date.now() - sessionStart
    const remaining = ABSOLUTE_TIMEOUT_MS - elapsed

    if (remaining <= 0) { doSignout(); return }

    if (remaining <= ABSOLUTE_WARNING_MS && warningShownRef.current !== 'absolute') {
      warningShownRef.current = 'absolute'
      setWarningMsLeft(remaining)
      setWarning('absolute')
    }
  }, [doSignout, setWarning])

  // ── Setup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    resetInactivity()
    getOrCreateSessionStart()
    checkAbsoluteLimit()
    absolutePollRef.current = setInterval(checkAbsoluteLimit, ABSOLUTE_POLL_MS)

    ACTIVITY_EVENTS.forEach(event =>
      window.addEventListener(event, resetInactivity, { passive: true })
    )

    return () => {
      clearInactivityTimers()
      if (absolutePollRef.current) clearInterval(absolutePollRef.current)
      ACTIVITY_EVENTS.forEach(event =>
        window.removeEventListener(event, resetInactivity)
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    warning,
    warningMsLeft,
    onKeepSession: useCallback(() => {
      setWarning(null)
      warningShownRef.current = null
      resetInactivity()
    }, [setWarning, resetInactivity]),
    onSignout: doSignout,
  }
}
