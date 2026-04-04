import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent } from '@sentry/nextjs'

// ── PII scrubbing ─────────────────────────────────────────────────────────────
// Applied to every event before it leaves the browser.
// Strips phone numbers, Meta tokens, and bearer tokens.

function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  // Remove session cookies — contain Supabase auth tokens
  if (event.request?.cookies) {
    event.request.cookies = {}
  }

  // Strip sensitive request headers
  if (event.request?.headers) {
    const BLOCKED = ['authorization', 'cookie', 'x-internal-secret']
    for (const key of BLOCKED) {
      delete (event.request.headers as Record<string, string>)[key]
    }
  }

  // Regex-scrub PII from the full serialized event payload
  const scrubbed = JSON.stringify(event)
    .replace(/\+\d{7,15}/g,                            '[PHONE]')
    .replace(/EAA[A-Za-z0-9]{10,}/g,                   '[META_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{20,}/gi,        'Bearer [TOKEN]')

  return JSON.parse(scrubbed) as ErrorEvent
}

// ── Init ──────────────────────────────────────────────────────────────────────

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // 10% of transactions sampled in prod — enough for perf insights without cost
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay disabled — avoids capturing sensitive form inputs and PII
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // ── Noise Filtering (Best Practice) ─────────────────────────────────────────
  // Ignore "ghost errors" coming from browser extensions or legacy scripts
  // that are not part of the Cronix codebase.
  ignoreErrors: [
    "updateFrom", // Common in legacy Sentry scripts (raven.js)
    /top\.GLOBALS/i,
    /webkit/i,
  ],

  denyUrls: [
    // Chrome extensions
    /extensions\//i,
    /^chrome:\/\//i,
    /^chrome-extension:\/\//i,
    // Firefox extensions
    /^moz-extension:\/\//i,
    // Legacy tracking scripts (unrelated to our stack)
    /raven\.js/i,
  ],

  beforeSend: scrubEvent,
});

