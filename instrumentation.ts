/**
 * Next.js Instrumentation Hook — App Router (Next.js 14+)
 *
 * This file is the canonical entry point for server-side Sentry initialization
 * in the App Router. It runs once per worker before any request is handled.
 *
 * - 'nodejs'  runtime → loads sentry.server.config.ts (full Node.js SDK)
 * - 'edge'    runtime → loads sentry.edge.config.ts  (minimal Edge SDK)
 *
 * Client-side Sentry is initialized via instrumentation-client.ts (Next.js 15+).
 */

import { captureRequestError } from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = captureRequestError
