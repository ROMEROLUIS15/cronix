/**
 * with-session-timeout.ts — Enforces session lifetime and inactivity limits.
 *
 * Rules:
 *  - 30-minute inactivity timeout → sign out + redirect to /login?reason=inactivity
 *  - 12-hour absolute session limit → sign out + redirect to /login?reason=session_expired
 *  - Activity cookie auto-refreshes on each tracked request.
 *  - Session start cookie is set once and never renewed.
 *
 * Only runs for authenticated users on tracked paths (/dashboard, /api/activity/ping).
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { MiddlewareFn } from './compose'
import { INACTIVITY_LIMIT_MS, MAX_SESSION_MS, ACTIVITY_COOKIE, SESSION_START_COOKIE } from './constants'
import { stripLocalePrefix, clearSessionCookies, redirectToLogin } from './utils'

export const withSessionTimeout: MiddlewareFn = async (req, baseRes, next) => {
  const pathname = stripLocalePrefix(req.nextUrl.pathname)
  const userId = baseRes.headers.get('x-user-id')

  if (!userId) return null // unauthenticated — no session to enforce

  const isTracked = pathname.startsWith('/dashboard') || pathname === '/api/activity/ping'
  if (!isTracked) return null

  // 1. Hard 12-hour absolute limit
  if (isMaxSessionExpired(req)) {
    const response = await signOutAndRedirect(req, 'session_expired')
    copyCookies(baseRes, response)
    return response
  }

  // 2. 30-minute inactivity limit
  if (isInactive(req)) {
    const response = await signOutAndRedirect(req, 'inactivity')
    copyCookies(baseRes, response)
    return response
  }

  // 3. Active session — refresh activity timestamp
  stampActivity(baseRes, req)

  return null
}

// ── Private helpers ──────────────────────────────────────────────────────────

function isInactive(request: NextRequest): boolean {
  const raw = request.cookies.get(ACTIVITY_COOKIE)?.value
  const sessionStart = request.cookies.get(SESSION_START_COOKIE)?.value

  if (!raw) return !!sessionStart // activity cookie expired → inactive

  const lastActivity = parseInt(raw, 10)
  if (isNaN(lastActivity)) return false
  return Date.now() - lastActivity > INACTIVITY_LIMIT_MS
}

function isMaxSessionExpired(request: NextRequest): boolean {
  const raw = request.cookies.get(SESSION_START_COOKIE)?.value
  if (!raw) return false
  const start = parseInt(raw, 10)
  if (isNaN(start)) return false
  return Date.now() - start > MAX_SESSION_MS
}

function stampActivity(response: NextResponse, request: NextRequest): void {
  response.cookies.set(ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // ✅ Prevent cookie theft over HTTP
    sameSite: 'lax',
    path: '/',
    maxAge: INACTIVITY_LIMIT_MS / 1000,
  })

  if (!request.cookies.get(SESSION_START_COOKIE)?.value) {
    response.cookies.set(SESSION_START_COOKIE, String(Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // ✅ Prevent cookie theft over HTTP
      sameSite: 'lax',
      path: '/',
      maxAge: (MAX_SESSION_MS / 1000) + 3600, // +1h buffer
    })
  }
}

async function signOutAndRedirect(request: NextRequest, reason: string): Promise<NextResponse> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } },
  )
  await supabase.auth.signOut()
  const redirect = redirectToLogin(request, reason)
  clearSessionCookies(redirect)
  return redirect
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.headers.getSetCookie()) {
    to.headers.append('set-cookie', cookie)
  }
}
