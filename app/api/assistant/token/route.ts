import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'

/**
 * DEPRECATED — v5.1 (2026-04-05)
 *
 * Audio processing moved entirely server-side to POST /api/assistant/voice.
 * Kept for backwards compatibility with stale JS sessions (not Service Workers).
 * Safe to delete once Sentry shows 0 hits on tag 'DEPRECATED-ENDPOINT' for 30 days.
 */
export const GET = withErrorHandler(async (req, _context, _supabase, user) => {
  logger.error(
    'DEPRECATED-ENDPOINT',
    'Token endpoint invoked by stale session — safe to ignore, tracking for deprecation window',
    {
      userId: user.id,
      userAgent: req.headers.get('user-agent') ?? 'unknown',
      deprecatedSince: '2026-04-05',
      replacement: 'POST /api/assistant/voice'
    }
  )

  return NextResponse.json(
    {
      error: 'DEPRECATED',
      message: 'Este endpoint fue deprecado en V5.1. El backend maneja STT/TTS directamente.',
      replacement: 'POST /api/assistant/voice',
      deprecatedSince: '2026-04-05'
    },
    { status: 410 }
  )
})
