import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'

type ApiHandler = (
  req: NextRequest, 
  context: { params: Record<string, string | string[]> },
  supabase: any,
  user: any
) => Promise<NextResponse>

/**
 * Higher Order Function (HOF) to wrap API Route Handlers.
 * - Injects Supabase client & Authenticated User
 * - Catches all unhandled errors
 * - Standardizes error telemetry (Logic + Sentry)
 * - Returns clean, non-leaking JSON responses
 */
export function withErrorHandler(handler: ApiHandler) {
  return async (req: NextRequest, context: any) => {
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

    } catch (err: any) {
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
