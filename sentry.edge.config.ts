import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent } from '@sentry/nextjs'

// ── Minimal scrubbing for Vercel Edge Runtime (middleware) ────────────────────
// Edge Runtime has limited Node.js APIs — keep this config lean.

function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request?.cookies) {
    event.request.cookies = {}
  }

  if (event.request?.headers) {
    const BLOCKED = ['authorization', 'cookie']
    for (const key of BLOCKED) {
      delete (event.request.headers as Record<string, string>)[key]
    }
  }

  return event
}

// ── Init ──────────────────────────────────────────────────────────────────────

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // No distributed tracing in Edge middleware — avoids header injection overhead
  tracesSampleRate: 0,

  beforeSend: scrubEvent,
})
