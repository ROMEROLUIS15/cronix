/**
 * Shared utilities for the middleware chain.
 * Extracted from the monolithic updateSession() to avoid duplication.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { routing } from '@/i18n/routing'

/**
 * Strip locale prefix from pathname so all path-matching works correctly.
 * /en/dashboard → /dashboard, /fr/login → /login, /dashboard → /dashboard
 */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1) || '/'
    }
  }
  return pathname
}

/**
 * Extract client IP from request headers (proxy-aware).
 */
export function getClientIP(request: NextRequest): string {
  const xForwardedFor = request.headers.get('x-forwarded-for')
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0] ?? 'unknown'
  }
  return '127.0.0.1'
}

/**
 * Check if request has Supabase session cookies (fast path guard).
 */
export function hasSessionCookies(request: NextRequest): boolean {
  return request.cookies.getAll().some(c => c.name.startsWith('sb-'))
}

/**
 * Classify the request path for routing purposes.
 */
export function classifyPath(pathname: string): {
  isAuth: boolean
  isApi: boolean
  isTracked: boolean
  isDashboardPage: boolean
} {
  const isAuthPath = ['/login', '/register', '/forgot-password', '/reset-password'].includes(pathname)
  const isApiPath = pathname.startsWith('/api/') && pathname !== '/api/activity/ping'
  const isTrackedPath = pathname.startsWith('/dashboard') || pathname === '/api/activity/ping'
  const isDashboardPage = pathname.startsWith('/dashboard') && !pathname.startsWith('/api/')

  return {
    isAuth: isAuthPath,
    isApi: isApiPath,
    isTracked: isTrackedPath,
    isDashboardPage,
  }
}

/**
 * Copy all cookies from one response to another.
 */
export function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.headers.getSetCookie()) {
    to.headers.append('set-cookie', cookie)
  }
}

/**
 * Redirect to login with optional reason parameter.
 */
export function redirectToLogin(request: NextRequest, reason?: string): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  if (reason) url.searchParams.set('reason', reason)
  return NextResponse.redirect(url)
}

/**
 * Clear all session cookies from the response.
 */
export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set('cronix_last_activity', '', { maxAge: 0, path: '/' })
  response.cookies.set('cronix_session_start', '', { maxAge: 0, path: '/' })
  response.cookies.set('cronix_user_status', '', { maxAge: 0, path: '/' })
}
