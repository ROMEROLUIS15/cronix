import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent } from '@sentry/nextjs'

// ── PII scrubbing ─────────────────────────────────────────────────────────────
// Applied server-side before any event is sent to Sentry.
// More aggressive than the client scrubber — also strips webhook signatures.

function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request?.cookies) {
    event.request.cookies = {}
  }

  if (event.request?.headers) {
    const BLOCKED = [
      'authorization',
      'cookie',
      'x-internal-secret',
      'x-hub-signature-256',  // Meta webhook HMAC — never log this
    ]
    for (const key of BLOCKED) {
      delete (event.request.headers as Record<string, string>)[key]
    }
  }

  const scrubbed = JSON.stringify(event)
    .replace(/\+\d{7,15}/g,                                         '[PHONE]')
    .replace(/EAA[A-Za-z0-9]{10,}/g,                                '[META_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{20,}/gi,                    'Bearer [TOKEN]')
    // Strip secret env var values if they appear in error messages
    .replace(
      /(CRON_SECRET|SERVICE_ROLE_KEY|LLM_API_KEY|WHATSAPP_ACCESS_TOKEN)=[^\s"&,}]+/g,
      '$1=[REDACTED]',
    )

  return JSON.parse(scrubbed) as ErrorEvent
}

// ── Init ──────────────────────────────────────────────────────────────────────

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  environment: process.env.NODE_ENV,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  beforeSend: scrubEvent,
})
