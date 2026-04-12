/**
 * with-request-id.ts — Injects a unique X-Request-ID header on every response.
 *
 * Enables distributed tracing across Sentry, Axiom, and Vercel logs.
 */

import { type NextRequest, NextResponse } from 'next/server'
import type { MiddlewareFn } from './compose'

export const withRequestId: MiddlewareFn = async (_req, res) => {
  res.headers.set('x-request-id', crypto.randomUUID())
  return null // continue chain
}
