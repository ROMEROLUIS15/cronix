/**
 * middleware-session.ts — Backward-compatible updateSession() function.
 *
 * Internally uses the new decomposed middleware chain so that existing
 * callers (root middleware.ts) don't break during the migration.
 *
 * @deprecated Use the composed chain from '@/lib/middleware' directly.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { compose, withRequestId, withRateLimit, withSession, withUserStatus, withSessionTimeout, withCsrf } from '@/lib/middleware'

// Pre-built chain for the legacy updateSession() caller
const legacyChain = compose(withRequestId, withRateLimit, withSession, withUserStatus, withCsrf, withSessionTimeout)

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  return legacyChain(request)
}
