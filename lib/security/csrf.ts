/**
 * csrf.ts — CSRF protection for Server Actions and API routes.
 *
 * Next.js Server Actions use POST requests but lack built-in CSRF tokens.
 * This module provides:
 *  1. CSRF token generation/validation (double-submit cookie pattern)
 *  2. SameSite=strict enforcement (default for session cookies)
 *
 * Usage in Server Actions:
 *   import { verifyCsrfToken } from '@/lib/security/csrf'
 *   await verifyCsrfToken()
 *
 * Usage in middleware (already applied via withCsrfHeaders):
 *   Headers are set automatically for all authenticated responses.
 */

import { cookies, headers } from 'next/headers'

const CSRF_COOKIE_NAME = 'cronix_csrf_token'
const CSRF_HEADER_NAME = 'x-csrf-token'

/**
 * Generates a cryptographically secure CSRF token.
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Sets the CSRF token cookie. Call this in authenticated responses.
 * Uses SameSite=strict to prevent cross-site request forgery.
 * cookies() is async in Next.js 15.
 */
export async function setCsrfCookie(token?: string): Promise<void> {
  const csrfToken = token || generateCsrfToken()
  const cookieStore = await cookies()

  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // Must be readable by client JS for form submissions
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60, // 1 hour
  })
}

/**
 * Verifies the CSRF token from the request header against the cookie.
 * Throws on mismatch — call this in Server Actions before processing.
 * Both headers() and cookies() are async in Next.js 15.
 */
export async function verifyCsrfToken(): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  const cookieToken = cookieStore.get(CSRF_COOKIE_NAME)?.value
  const headerToken = headerStore.get(CSRF_HEADER_NAME)

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new Error('CSRF token validation failed')
  }
}

/**
 * Returns the current CSRF token (generates one if missing).
 */
export async function getCsrfToken(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value

  if (existing) return existing

  const newToken = generateCsrfToken()
  await setCsrfCookie(newToken)
  return newToken
}
