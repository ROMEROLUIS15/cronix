/**
 * Sentry helper for Supabase Edge Functions (Deno runtime).
 *
 * Usage in any Edge Function:
 *
 *   import { initSentry, captureException, addBreadcrumb, setSentryTag, flushSentry }
 *     from '../_shared/sentry.ts'
 *
 *   initSentry('my-function-name')   // call once at module level (Deno caches it)
 *
 * Required secret (set via Supabase Dashboard or CLI):
 *   npx supabase secrets set SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
 *
 * If SENTRY_DSN is absent all calls are silent no-ops — safe in local dev.
 *
 * IMPORTANT: call `await flushSentry()` before every `return new Response(...)`.
 * Deno workers can be killed before async tasks complete, so flushing is mandatory.
 */

// deno-lint-ignore-file no-explicit-any

import * as Sentry from 'npm:@sentry/deno'

type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

const DSN = Deno.env.get('SENTRY_DSN') ?? ''

// ── PII scrubbing ─────────────────────────────────────────────────────────────

const HEADER_BLOCKLIST = [
  'authorization',
  'cookie',
  'x-internal-secret',   // Cronix internal cron auth
  'x-hub-signature-256', // Meta webhook HMAC — must never appear in logs
]

function scrubRawJson(raw: string): string {
  return raw
    // E.164 phone numbers (e.g. +573001234567)
    .replace(/\+\d{7,15}/g,                                           '[PHONE]')
    // Meta long-lived tokens (always start with EAA)
    .replace(/EAA[A-Za-z0-9]{10,}/g,                                  '[META_TOKEN]')
    // Bearer tokens in Authorization headers or plain strings
    .replace(/Bearer\s+[A-Za-z0-9._\-]{20,}/gi,                      'Bearer [TOKEN]')
    // Secret env var values if accidentally included in error messages
    .replace(
      /(CRON_SECRET|SERVICE_ROLE_KEY|LLM_API_KEY|WHATSAPP_ACCESS_TOKEN)=[^\s"&,}\]]+/g,
      '$1=[REDACTED]',
    )
}

function scrubEvent(event: any): any | null {
  // Strip sensitive headers
  if (event.request?.headers) {
    for (const key of HEADER_BLOCKLIST) {
      delete event.request.headers[key]
    }
  }

  // Strip all cookies
  if (event.request?.cookies) event.request.cookies = {}

  // Deep-scrub PII from the entire serialized event
  const scrubbed = scrubRawJson(JSON.stringify(event))
  return JSON.parse(scrubbed)
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialize Sentry for the given Edge Function.
 * Safe to call at module level — Deno caches modules, so this runs once per
 * cold start, not once per request.
 */
export function initSentry(functionName: string): void {
  if (!DSN) return

  Sentry.init({
    dsn:         DSN,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    release:     Deno.env.get('SENTRY_RELEASE'),

    // Sample 10% of transactions — sufficient for perf insights in prod
    tracesSampleRate: 0.1,

    beforeSend: scrubEvent,
  })

  // Tag every event from this function for easy filtering in Sentry
  Sentry.setTag('function_name', functionName)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Captures an exception with optional extra context.
 * Accepts any thrown value — Error instances, strings, unknown.
 */
export function captureException(
  error:  unknown,
  extra?: Record<string, unknown>,
): void {
  if (!DSN) return

  if (extra) {
    Sentry.withScope((scope: any) => {
      scope.setExtras(extra)
      Sentry.captureException(error)
    })
  } else {
    Sentry.captureException(error)
  }
}

/**
 * Records a business-flow step as a Sentry breadcrumb.
 * These appear in the "Breadcrumbs" panel of any subsequent error event,
 * showing exactly what happened before the crash.
 *
 * @example
 *   addBreadcrumb('Meta signature verified', 'security')
 *   addBreadcrumb('Sending prompt to Groq', 'llm', 'info', { model: 'llama-3.3-70b' })
 */
export function addBreadcrumb(
  message:  string,
  category: string,
  level:    SeverityLevel = 'info',
  data?:    Record<string, unknown>,
): void {
  if (!DSN) return
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
    timestamp: Date.now() / 1000,
  })
}

/**
 * Attaches a searchable tag to all subsequent events in this request scope.
 * Use for multi-tenant filtering (e.g. business_id).
 */
export function setSentryTag(key: string, value: string): void {
  if (!DSN) return
  Sentry.setTag(key, value)
}

/**
 * Flushes all pending Sentry events with a 2-second timeout.
 * MUST be awaited before every `return new Response(...)` in a Deno handler,
 * since the worker process can be killed before async tasks complete.
 */
export async function flushSentry(): Promise<void> {
  if (!DSN) return
  await Sentry.flush(2000)
}
