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
/** localStorage key that syncs activity timestamp across multiple tabs */
const LOCAL_ACTIVITY_KEY = 'cronix_local_activity'

/** Server ping throttle — max one ping per minute */
const PING_THROTTLE_MS = 60_000
/** Activity throttle — update local storage at most once per second */
const ACTIVITY_THROTTLE_MS = 1_000
/** How often to check the limits (ms) */
const CHECK_INTERVAL_MS = 1_000

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

  const warningShownRef      = useRef<SessionWarningType>(null)
  const lastPingRef          = useRef<number>(0)
  const lastActivityEventRef = useRef<number>(0)
  const checkIntervalRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const [warningMsLeft, setWarningMsLeft] = useState(0)

  // ── Sign out ──────────────────────────────────────────────────────────────
  const doSignout = useCallback(async () => {
    sessionStorage.removeItem(SESSION_START_KEY)
    localStorage.removeItem(LOCAL_ACTIVITY_KEY)
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

  // ── Activity tracking ──────────────────────────────────────────────────────
  const handleActivity = useCallback(() => {
    const now = Date.now()
    // Throttle DOM event processing to avoid flooding
    if (now - lastActivityEventRef.current < ACTIVITY_THROTTLE_MS) return
    lastActivityEventRef.current = now

    localStorage.setItem(LOCAL_ACTIVITY_KEY, String(now))
    pingServer()

    // If we became active, hide inactivity warning
    if (warningRef.current === 'inactivity') {
      setWarning(null)
      warningShownRef.current = null
    }
  }, [pingServer, setWarning])

  // ── Periodic Check ────────────────────────────────────────────────────────
  const checkLimits = useCallback(() => {
    const now = Date.now()
    
    // 1. Check absolute limit
    const sessionStart = getOrCreateSessionStart()
    const absoluteElapsed = now - sessionStart
    const absoluteRemaining = ABSOLUTE_TIMEOUT_MS - absoluteElapsed

    if (absoluteRemaining <= 0) { 
      doSignout()
      return 
    }

    if (absoluteRemaining <= ABSOLUTE_WARNING_MS && warningShownRef.current !== 'absolute') {
      warningShownRef.current = 'absolute'
      setWarningMsLeft(absoluteRemaining)
      setWarning('absolute')
      return // prioritize absolute warning over inactivity
    }
    
    if (warningShownRef.current === 'absolute') {
      setWarningMsLeft(absoluteRemaining)
      return
    }

    // 2. Check inactivity limit
    const storedActivity = localStorage.getItem(LOCAL_ACTIVITY_KEY)
    let lastActivity = storedActivity ? parseInt(storedActivity, 10) : NaN
    
    // Initialize if empty
    if (isNaN(lastActivity)) {
      lastActivity = now
      localStorage.setItem(LOCAL_ACTIVITY_KEY, String(now))
    }

    const inactivityElapsed = now - lastActivity
    const inactivityRemaining = INACTIVITY_TIMEOUT_MS - inactivityElapsed

    if (inactivityRemaining <= 0) {
      doSignout()
      return
    }

    if (inactivityRemaining <= INACTIVITY_WARNING_MS) {
      if (warningShownRef.current !== 'inactivity') {
        warningShownRef.current = 'inactivity'
        setWarning('inactivity')
      }
      setWarningMsLeft(inactivityRemaining)
    } else {
      // If activity happened in another tab, clear warning here
      if (warningShownRef.current === 'inactivity') {
        warningShownRef.current = null
        setWarning(null)
      }
    }
  }, [doSignout, setWarning])

  // ── Setup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Initialize
    handleActivity()
    getOrCreateSessionStart()
    
    // Run interval instead of setTimeout to avoid background throttling issues
    checkIntervalRef.current = setInterval(checkLimits, CHECK_INTERVAL_MS)

    ACTIVITY_EVENTS.forEach(event =>
      window.addEventListener(event, handleActivity, { passive: true })
    )

    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
      ACTIVITY_EVENTS.forEach(event =>
        window.removeEventListener(event, handleActivity)
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
      handleActivity()
    }, [setWarning, handleActivity]),
    onSignout: doSignout,
  }
}

