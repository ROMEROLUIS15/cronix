'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { signout } from '@/app/login/actions'

// ── Constants ──────────────────────────────────────────────────────────────
/** Sign out after 30 min of inactivity */
const INACTIVITY_TIMEOUT_MS  = 30 * 60 * 1000          // 30 min
/** Show warning this many ms before inactivity timeout fires */
const INACTIVITY_WARNING_MS  = 2  * 60 * 1000          // 2 min before → at 28 min

/** Absolute session limit: 12 hours */
const ABSOLUTE_TIMEOUT_MS    = 12 * 60 * 60 * 1000     // 12 h
/** Show warning this many ms before the absolute limit */
const ABSOLUTE_WARNING_MS    = 10 * 60 * 1000          // 10 min before → at 11h50m

/** sessionStorage key that persists the login timestamp across page reloads */
const SESSION_START_KEY = 'cronix_session_start'

/** How often to re-check the absolute limit (ms) */
const ABSOLUTE_POLL_MS = 30_000 // every 30 s

const ACTIVITY_EVENTS = [
  'mousemove',
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

// ── Warning Dialog ─────────────────────────────────────────────────────────
interface WarningDialogProps {
  title:       string
  description: string
  /** ms remaining until forced signout */
  msLeft:      number
  onKeep?:     () => void
  onSignout:   () => void
}

function WarningDialog({ title, description, msLeft, onKeep, onSignout }: WarningDialogProps) {
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
          border: '1px solid #272729',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Icon */}
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center mx-auto text-2xl"
          style={{ backgroundColor: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.25)' }}
        >
          ⏱️
        </div>

        {/* Text */}
        <div className="text-center space-y-1.5">
          <h2 className="text-base font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.02em' }}>
            {title}
          </h2>
          <p className="text-sm" style={{ color: '#909098' }}>{description}</p>
        </div>

        {/* Countdown */}
        <div
          className="text-center py-3 rounded-xl"
          style={{ backgroundColor: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.2)' }}
        >
          <span className="text-2xl font-black tabular-nums" style={{ color: '#FFD60A' }}>
            {formatCountdown(remaining)}
          </span>
        </div>

        {/* Actions */}
        <div className={`grid gap-2 ${onKeep ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {onKeep && (
            <button
              onClick={onKeep}
              className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:brightness-110"
              style={{ backgroundColor: '#0062FF', color: '#fff' }}
            >
              Mantener sesión
            </button>
          )}
          <button
            onClick={onSignout}
            className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
            style={{
              backgroundColor: 'rgba(255,59,48,0.1)',
              color: '#FF3B30',
              border: '1px solid rgba(255,59,48,0.2)',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────
/**
 * Invisible component mounted once in DashboardLayout.
 * Enforces two independent session limits:
 *   1. Inactivity timeout  — signs out after 15min with no user activity,
 *                            with a 2-min warning dialog.
 *   2. Absolute timeout    — signs out after 12h regardless of activity,
 *                            stored in sessionStorage so page reloads don't
 *                            reset the clock; shows a 10-min warning dialog.
 */
export function SessionTimeout() {
  // ── Warning state ─────────────────────────────────────────────────────────
  type WarningType = 'inactivity' | 'absolute' | null
  const [warning, setWarning] = useState<WarningType>(null)
  const [warningMsLeft, setWarningMsLeft] = useState(0)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const inactivityRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inactivityWarningRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absolutePollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningShownRef      = useRef<WarningType>(null) // debounce duplicate shows

  // ── Sign out helpers ───────────────────────────────────────────────────────
  const doSignout = useCallback(async () => {
    sessionStorage.removeItem(SESSION_START_KEY)
    await signout()
  }, [])

  // ── INACTIVITY TIMER ──────────────────────────────────────────────────────
  const clearInactivityTimers = useCallback(() => {
    if (inactivityRef.current)        clearTimeout(inactivityRef.current)
    if (inactivityWarningRef.current) clearTimeout(inactivityWarningRef.current)
  }, [])

  const resetInactivity = useCallback(() => {
    clearInactivityTimers()
    // Dismiss inactivity warning if user acted
    if (warning === 'inactivity') {
      setWarning(null)
      warningShownRef.current = null
    }

    // Warning fires at 13 min (2 min before the 15 min limit)
    inactivityWarningRef.current = setTimeout(() => {
      if (warningShownRef.current !== 'inactivity') {
        warningShownRef.current = 'inactivity'
        setWarningMsLeft(INACTIVITY_WARNING_MS)
        setWarning('inactivity')
      }
    }, INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS)

    // Hard signout at 15 min
    inactivityRef.current = setTimeout(() => {
      doSignout()
    }, INACTIVITY_TIMEOUT_MS)
  }, [clearInactivityTimers, doSignout, warning])

  // ── ABSOLUTE TIMER (sessionStorage-backed) ────────────────────────────────
  const checkAbsoluteLimit = useCallback(() => {
    const sessionStart = getOrCreateSessionStart()
    const elapsed  = Date.now() - sessionStart
    const remaining = ABSOLUTE_TIMEOUT_MS - elapsed

    if (remaining <= 0) {
      // 12 hours exceeded — sign out immediately
      doSignout()
      return
    }

    if (remaining <= ABSOLUTE_WARNING_MS && warningShownRef.current !== 'absolute') {
      warningShownRef.current = 'absolute'
      setWarningMsLeft(remaining)
      setWarning('absolute')
    }
  }, [doSignout])

  // ── Setup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Kick off the inactivity timer
    resetInactivity()

    // Ensure the session start timestamp exists in sessionStorage
    getOrCreateSessionStart()

    // Poll for absolute limit every 30s (survives page reloads via sessionStorage)
    checkAbsoluteLimit() // check immediately on mount
    absolutePollRef.current = setInterval(checkAbsoluteLimit, ABSOLUTE_POLL_MS)

    // Register user activity listeners
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

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!warning) return null

  if (warning === 'inactivity') {
    return (
      <WarningDialog
        title="¿Sigues ahí?"
        description="Tu sesión se cerrará por inactividad. ¿Deseas mantenerla activa?"
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

  // absolute warning — no "keep" button since it's a hard limit
  return (
    <WarningDialog
      title="Sesión por expirar"
      description="Tu sesión alcanzará el límite de 12 horas. Guarda tu trabajo y vuelve a iniciar sesión."
      msLeft={warningMsLeft}
      onSignout={doSignout}
    />
  )
}