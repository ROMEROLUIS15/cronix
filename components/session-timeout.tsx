'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { signout } from '@/lib/actions/auth'

// ── Constants ───────────────────────────────────────────────────────────────
/** Sign out after 30 min of inactivity */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000         // 30 min
/** Show warning this many ms before inactivity timeout fires */
const INACTIVITY_WARNING_MS = 2  * 60 * 1000          // 2 min before → at 28 min

/** Absolute session limit: 12 hours */
const ABSOLUTE_TIMEOUT_MS   = 12 * 60 * 60 * 1000    // 12 h
/** Show warning this many ms before the absolute limit */
const ABSOLUTE_WARNING_MS   = 10 * 60 * 1000          // 10 min before → at 11h50m

/** sessionStorage key that persists the login timestamp across page reloads */
const SESSION_START_KEY = 'cronix_session_start'

/** How often to re-check the absolute limit (ms) */
const ABSOLUTE_POLL_MS = 30_000

/** Server ping throttle — max one ping per minute */
const PING_THROTTLE_MS = 60_000

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'click',
  'touchstart',
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

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')} min` : `${s} seg`
}

// ── Warning Dialog ──────────────────────────────────────────────────────────
interface WarningDialogProps {
  title:     string
  description: string
  msLeft:    number
  onKeep?:   () => void
  onSignout: () => void
}

function WarningDialog({ title, description, msLeft, onKeep, onSignout }: WarningDialogProps) {
  const t = useTranslations('sessionTimeout')
  const [remaining, setRemaining] = useState(msLeft)

  useEffect(() => {
    setRemaining(msLeft)
    const iv = setInterval(() => {
      setRemaining(prev => {
        const next = prev - 1000
        if (next <= 0) clearInterval(iv)
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [msLeft])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4 animate-slide-up"
        style={{
          backgroundColor: '#1A1A1F',
          border:          '1px solid #272729',
          boxShadow:       '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center mx-auto text-2xl"
          style={{ backgroundColor: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.25)' }}
        >
          ⏱️
        </div>

        <div className="text-center space-y-1.5">
          <h2 className="text-base font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.02em' }}>
            {title}
          </h2>
          <p className="text-sm" style={{ color: '#909098' }}>{description}</p>
        </div>

        <div
          className="text-center py-3 rounded-xl"
          style={{ backgroundColor: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.2)' }}
        >
          <span className="text-2xl font-black tabular-nums" style={{ color: '#FFD60A' }}>
            {formatCountdown(remaining)}
          </span>
        </div>

        <div className={`grid gap-2 ${onKeep ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {onKeep && (
            <button
              onClick={onKeep}
              className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:brightness-110"
              style={{ backgroundColor: '#0062FF', color: '#fff' }}
            >
              {t('keepSession')}
            </button>
          )}
          <button
            onClick={onSignout}
            className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
            style={{
              backgroundColor: 'rgba(255,59,48,0.1)',
              color:           '#FF3B30',
              border:          '1px solid rgba(255,59,48,0.2)',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────────────────
/**
 * Invisible component mounted once in DashboardLayout.
 * Enforces two independent session limits:
 *
 *   1. Inactivity timeout  — signs out after 30 min with no user activity
 *                            (mousemove, keydown, scroll, click, touchstart).
 *                            Shows a 2-min warning at 28 min.
 *
 *   2. Absolute timeout    — signs out after 12 h regardless of activity,
 *                            stored in sessionStorage so page reloads don't
 *                            reset the clock. Shows a 10-min warning at 11h50m.
 *
 * Additionally, user activity is synced to the server via POST /api/activity/ping
 * (throttled to once per minute) so the server-side middleware cookie stays fresh
 * even when the user stays on a single page without navigating.
 */
export function SessionTimeout() {
  const t = useTranslations('sessionTimeout')
  type WarningType = 'inactivity' | 'absolute' | null

  // ── Use a ref to expose current warning state to stable event handlers ─────
  // This fixes the stale closure problem: event listeners registered once at
  // mount always see the latest warning value via warningRef.current.
  const warningRef              = useRef<WarningType>(null)
  const [warning, _setWarning]  = useState<WarningType>(null)
  const setWarning              = useCallback((w: WarningType) => {
    warningRef.current = w
    _setWarning(w)
  }, [])

  // ── Refs ──────────────────────────────────────────────────────────────────
  const inactivityRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inactivityWarningRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absolutePollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningShownRef      = useRef<WarningType>(null)
  const lastPingRef          = useRef<number>(0)
  const [warningMsLeft, setWarningMsLeft] = useState(0)

  // ── Sign out ──────────────────────────────────────────────────────────────
  const doSignout = useCallback(async () => {
    sessionStorage.removeItem(SESSION_START_KEY)
    await signout()
  }, [])

  // ── Server ping (throttled) ───────────────────────────────────────────────
  // Keeps the middleware's cronix_last_activity cookie fresh while the user
  // stays on the same page without triggering a navigation.
  const pingServer = useCallback(async () => {
    const now = Date.now()
    if (now - lastPingRef.current < PING_THROTTLE_MS) return
    lastPingRef.current = now
    try {
      await fetch('/api/activity/ping', { method: 'POST' })
    } catch {
      // silently ignore — the middleware will catch it on the next navigation
    }
  }, [])

  // ── Inactivity timer ─────────────────────────────────────────────────────
  const clearInactivityTimers = useCallback(() => {
    if (inactivityRef.current)        clearTimeout(inactivityRef.current)
    if (inactivityWarningRef.current) clearTimeout(inactivityWarningRef.current)
  }, [])

  const resetInactivity = useCallback(() => {
    clearInactivityTimers()

    // Ping the server so the middleware cookie stays in sync
    pingServer()

    // Dismiss inactivity warning if user acted — use ref to avoid stale closure
    if (warningRef.current === 'inactivity') {
      setWarning(null)
      warningShownRef.current = null
    }

    // Warning at 28 min
    inactivityWarningRef.current = setTimeout(() => {
      if (warningShownRef.current !== 'inactivity') {
        warningShownRef.current = 'inactivity'
        setWarningMsLeft(INACTIVITY_WARNING_MS)
        setWarning('inactivity')
      }
    }, INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS)

    // Hard signout at 30 min
    inactivityRef.current = setTimeout(() => {
      doSignout()
    }, INACTIVITY_TIMEOUT_MS)
  }, [clearInactivityTimers, doSignout, pingServer, setWarning])

  // ── Absolute timer (sessionStorage-backed) ────────────────────────────────
  const checkAbsoluteLimit = useCallback(() => {
    const sessionStart = getOrCreateSessionStart()
    const elapsed      = Date.now() - sessionStart
    const remaining    = ABSOLUTE_TIMEOUT_MS - elapsed

    if (remaining <= 0) {
      doSignout()
      return
    }

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

  // ── Render ────────────────────────────────────────────────────────────────
  if (!warning) return null

  if (warning === 'inactivity') {
    return (
      <WarningDialog
        title={t('stillThereTitle')}
        description={t('stillThereDesc')}
        msLeft={warningMsLeft}
        onKeep={() => {
          setWarning(null)
          warningShownRef.current = null
          resetInactivity()
        }}
        onSignout={doSignout}
      />
    )
  }

  return (
    <WarningDialog
      title={t('expiringTitle')}
      description={t('expiringDesc')}
      msLeft={warningMsLeft}
      onSignout={doSignout}
    />
  )
}
