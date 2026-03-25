/**
 * Centralized logger — single point of control for all app logging.
 *
 * Why: Eliminates scattered console.* calls. In production, errors can be
 * routed to an observability service (Sentry, Datadog, etc.) by modifying
 * only this file. User-facing messages remain generic and safe.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.error('getSession', 'DB fetch failed', dbError)
 *   logger.warn('push-notify', 'invoke error', error.message)
 *
 * NOTE: Edge Functions (supabase/functions/) run on Deno and cannot import
 * from this file — they keep their own console.* calls.
 */

type LogLevel = 'error' | 'warn' | 'info'

function log(level: LogLevel, tag: string, message: string, detail?: unknown): void {
  // In production, replace this block with your observability SDK:
  //   Sentry.captureException(detail instanceof Error ? detail : new Error(message), { tags: { tag } })
  //   return

  const prefix = `[${tag}]`

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(prefix, message, detail ?? '')
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(prefix, message, detail ?? '')
  } else {
    // eslint-disable-next-line no-console
    console.log(prefix, message, detail ?? '')
  }
}

export const logger = {
  error: (tag: string, message: string, detail?: unknown) => log('error', tag, message, detail),
  warn:  (tag: string, message: string, detail?: unknown) => log('warn', tag, message, detail),
  info:  (tag: string, message: string, detail?: unknown) => log('info', tag, message, detail),
}
