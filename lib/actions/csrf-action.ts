/**
 * csrf-action.ts — CSRF validation helper for Server Actions.
 *
 * Next.js Server Actions have built-in CSRF protection via encrypted request
 * tokens in the RSC payload. This helper adds an additional defense-in-depth
 * layer using the double-submit cookie pattern for state-mutating actions.
 *
 * Usage:
 *   await validateCsrfToken()
 *   // ... proceed with mutation
 */

import { cookies, headers } from 'next/headers'

const CSRF_COOKIE_NAME = 'cronix_csrf_token'
const CSRF_HEADER_NAME = 'x-csrf-token'

/**
 * Validates the CSRF token for state-mutating Server Actions.
 * Returns void, throws on validation failure.
 *
 * This is a defense-in-depth measure. Next.js already provides CSRF
 * protection for Server Actions, but this adds explicit verification.
 */
export async function validateCsrfToken(): Promise<void> {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const cookieToken = cookieStore.get(CSRF_COOKIE_NAME)?.value
  const headerToken = headerStore.get(CSRF_HEADER_NAME)

  // If no CSRF cookie is set, the user is likely not authenticated — skip
  // (Next.js built-in CSRF protection handles the rest)
  if (!cookieToken) return

  // If cookie is set but header is missing or mismatched, reject
  if (!headerToken || headerToken !== cookieToken) {
    throw new Error('Token de seguridad inválido (CSRF). Recargue la página e intente de nuevo.')
  }
}

/**
 * Middleware that wraps a Server Action with CSRF validation.
 * Usage:
 *   export const createEmployeeAction = withCsrf(async (input) => { ... })
 */
export function withCsrf<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    await validateCsrfToken()
    return fn(...args)
  }
}
