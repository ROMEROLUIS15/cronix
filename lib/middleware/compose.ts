/**
 * compose.ts — Middleware composition utility.
 *
 * Chains single-responsibility middleware functions into a pipeline.
 * Each middleware receives the request, the current response, and a next() function.
 *
 * Usage:
 *   const handler = compose(
 *     withRequestId,
 *     withRateLimit,
 *     withSession,
 *     withUserStatus,
 *     withSessionTimeout,
 *   )
 *   const response = await handler(request)
 */

import { type NextRequest, NextResponse } from 'next/server'

export type MiddlewareFn = (
  request: NextRequest,
  response: NextResponse,
  next: () => Promise<NextResponse>,
) => Promise<NextResponse | null>

/**
 * Composes multiple middleware functions into a single handler.
 * Middleware executes in order — first to last.
 * Return a Response to short-circuit the chain (e.g., redirect, 429).
 * Return null to continue to the next middleware.
 *
 * Design: each middleware advances the chain by returning null (not by calling next()).
 * The next() parameter is intentionally a no-op stub — it exists only for signature
 * compatibility with the MiddlewareFn type. Calling it has no effect on chain execution.
 */
export function compose(...middlewares: MiddlewareFn[]): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const baseRes = NextResponse.next({ request })

    const execute = async (req: NextRequest, res: NextResponse, index: number): Promise<NextResponse> => {
      if (index >= middlewares.length) return res

      const current = middlewares[index]
      if (!current) return res

      // next() is a no-op stub — chain advances when middleware returns null
      const result = await current(req, res, async () => res)

      // Middleware returned a response different from the base → short-circuit (redirect, error, etc.)
      if (result && result !== res) return result

      // Middleware returned null or the same base response → advance to next middleware
      return execute(req, res, index + 1)
    }

    return execute(request, baseRes, 0)
  }
}
