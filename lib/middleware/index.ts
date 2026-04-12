/**
 * lib/middleware — Composable middleware chain for Cronix.
 *
 * Each file has a single responsibility and can be tested in isolation.
 * The chain executes in order:
 *   1. withRequestId    → always runs, adds tracing header
 *   2. withRateLimit    → DB-based rate limiting for auth/API
 *   3. withSession      → Supabase auth + redirect logic
 *   4. withUserStatus   → blocks rejected users
 *   5. withSessionTimeout → inactivity + 12h absolute limit
 */

export { compose } from './compose'
export type { MiddlewareFn } from './compose'
export { withRequestId } from './with-request-id'
export { withRateLimit } from './with-rate-limit'
export { withSession } from './with-session'
export { withUserStatus } from './with-user-status'
export { withSessionTimeout } from './with-session-timeout'
export { withCsrf } from './with-csrf'
export { stripLocalePrefix, getClientIP, hasSessionCookies, classifyPath } from './utils'
export * from './constants'
