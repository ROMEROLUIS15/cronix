/**
 * with-csrf.ts — Sets CSRF token cookie on every authenticated response.
 *
 * Uses the double-submit cookie pattern:
 *  1. Token is set as a non-httpOnly cookie (readable by client JS)
 *  2. Client must include the token in a custom header (x-csrf-token)
 *  3. Server validates header matches cookie on state-mutating requests
 *
 * Only runs for authenticated requests (when x-user-id is present).
 */

import { type NextRequest, NextResponse } from 'next/server'
import type { MiddlewareFn } from './compose'

/**
 * Generates a cryptographically secure CSRF token.
 */
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export const withCsrf: MiddlewareFn = async (req, baseRes) => {
  const userId = baseRes.headers.get('x-user-id')

  // Only set CSRF token for authenticated users
  if (userId) {
    const existingToken = req.cookies.get('cronix_csrf_token')?.value
    const token = existingToken || generateToken()

    baseRes.cookies.set('cronix_csrf_token', token, {
      httpOnly: false, // Readable by client JS for form submissions
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    })
  }

  return null // continue chain
}
