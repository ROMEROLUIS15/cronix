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

import * as Sentry from '@sentry/nextjs'

function log(level: LogLevel, tag: string, message: string, detail?: unknown): void {
  const prefix = `[${tag}]`

  // 1. Console logging (Development/Debug)
  if (level === 'error') {
    console.error(prefix, message, detail ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, message, detail ?? '')
  } else {
    console.log(prefix, message, detail ?? '')
  }

  // 2. Production Observability (Sentry)
  if (level === 'error' && process.env.NODE_ENV === 'production') {
    Sentry.captureException(detail instanceof Error ? detail : new Error(`${prefix} ${message}`), {
      tags: { tag, component: 'logger' },
      extra: { detail: JSON.stringify(detail) }
    })
  }
}

export const logger = {
  error: (tag: string, message: string, detail?: unknown) => log('error', tag, message, detail),
  warn:  (tag: string, message: string, detail?: unknown) => log('warn', tag, message, detail),
  info:  (tag: string, message: string, detail?: unknown) => log('info', tag, message, detail),
}
