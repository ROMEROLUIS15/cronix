/**
 * Sentry server-side context helpers.
 *
 * Must be called only in Server Components, Server Actions, or Route Handlers
 * (Node.js runtime). @sentry/nextjs uses AsyncLocalStorage to scope context
 * per request, so each call only affects the current request's events.
 *
 * Multi-tenancy strategy:
 *   - user.id   → Sentry "Affected Users" count + user-level filtering
 *   - business_id   → Tag for tenant-level filtering ("errors for Business X")
 *   - business_name → Human-readable label in the Sentry UI
 */

import * as Sentry from '@sentry/nextjs'

/**
 * Sets user and business context for all Sentry events in the current request.
 * Call once per request at the outermost server boundary (e.g. dashboard layout).
 */
export function setSentryUser(
  userId:       string,
  businessId:   string | null,
  businessName: string | null,
): void {
  Sentry.setUser({ id: userId })

  if (businessId)   Sentry.setTag('business_id',   businessId)
  if (businessName) Sentry.setTag('business_name', businessName)
}
