/**
 * with-session.ts — Supabase authentication session management.
 *
 * Responsibilities:
 *  - Creates Supabase server client with cookie handling.
 *  - Validates user session locally via getClaims (asymmetric ES256 — no Auth round-trip).
 *  - Redirects unauthenticated users from /dashboard → /login.
 *  - Redirects authenticated users from /login, /register → /dashboard.
 *  - Clears stale session cookies on auth failure.
 *  - Sets x-user-id header on baseRes for downstream middleware.
 *
 * Does NOT handle: rate limiting, user status, session timeouts.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { MiddlewareFn } from './compose'
import { hasSessionCookies, stripLocalePrefix, clearSessionCookies, redirectToLogin, copyCookies } from './utils'

export const withSession: MiddlewareFn = async (req, baseRes, next) => {
  const pathname = stripLocalePrefix(req.nextUrl.pathname)
  const isDashboard = pathname.startsWith('/dashboard')
  const isAuthPage = pathname === '/login' || pathname === '/register'

  // Fast path — no Supabase cookies → unauthenticated
  if (!hasSessionCookies(req)) {
    if (isDashboard) return redirectToLogin(req)
    return null // let public pages through
  }

  let supabaseResponse: NextResponse | null = null

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse!.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getClaims verifies the JWT locally against the project's asymmetric (ES256)
  // signing key — no /auth/v1/user round-trip per request (JWKS is cached at
  // module level across requests). It still calls getSession() first, so token
  // refresh + the cookie rewrite via setAll is preserved. Banned-user revocation
  // stays enforced by withUserStatus (its own DB check on users.status).
  const { data, error: authError } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub ?? null

  // Stale token — clear cookies to prevent retry loops
  if (authError && !userId) {
    clearSessionCookies(baseRes)
    // Forward Supabase's cleared sb-* cookies so the browser actually removes them.
    // Without this, the browser keeps sending the stale refresh token on every request.
    if (supabaseResponse) {
      copyCookies(supabaseResponse, baseRes)
    }
    return null // continue chain (user will be caught by dashboard redirect below on next request)
  }

  // Unauthenticated trying to access dashboard
  if (!userId && isDashboard) {
    return redirectToLogin(req)
  }

  // Authenticated user on auth page → redirect to dashboard
  if (userId && isAuthPage) {
    const url = req.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Authenticated — expose user ID to downstream middleware
  if (userId) {
    baseRes.headers.set('x-user-id', userId)
  }

  // Copy Supabase cookies to base response
  if (supabaseResponse) {
    copyCookies(supabaseResponse, baseRes)
  }

  return null // continue chain
}
