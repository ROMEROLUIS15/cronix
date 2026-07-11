import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'

/** Exact type of the authenticated server client injected below. */
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Next.js 15 route context: `params` is a Promise. */
type RouteContext = { params: Promise<Record<string, string | string[]>> }

type ApiHandler = (
  req: NextRequest,
  context: RouteContext,
  supabase: SupabaseServerClient,
  user: User,
) => Promise<NextResponse>

/**
 * Higher Order Function (HOF) to wrap API Route Handlers.
 * - Injects Supabase client & Authenticated User
 * - Catches all unhandled errors
 * - Standardizes error telemetry (Logic + Sentry)
 * - Returns clean, non-leaking JSON responses
 */
export function withErrorHandler(handler: ApiHandler) {
  return async (req: NextRequest, context: RouteContext) => {
    const requestId = req.headers.get('x-request-id') || 'unknown'
    const supabase = await createClient()

    try {
      // 1. Auth check (default for dashboard APIs)
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError || !user) {
        logger.warn('API-AUTH', 'Unauthorized access attempt', { requestId })
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // 2. Execute actual handler
      return await handler(req, context, supabase, user)

    } catch (err: unknown) {
      // 3. Centralized Error Management
      const errorMsg = err instanceof Error ? err.message : 'Internal Server Error'
      const stack = err instanceof Error ? err.stack : undefined
      
      logger.error('API-CRASH', errorMsg, { 
        requestId,
        path: req.nextUrl.pathname,
        stack
      })

      // 4. Safe Public Response (never leak sensitive stack traces)
      return NextResponse.json(
        { 
          error: 'Ha ocurrido un error inesperado en el servidor.',
          requestId // Return Request ID so user can report it to support
        }, 
        { status: 500 }
      )
    }
  }
}
