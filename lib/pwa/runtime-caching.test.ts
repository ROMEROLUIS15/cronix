/**
 * Page requests go network first. Without a timeout, a connection that hangs
 * (connected but answering nothing, common on mobile data) left the installed
 * app blank for good, although a saved copy existed: measured 30 s+ blank on
 * production and on a local build, 2026-11-05.
 */
import { describe, expect, it } from 'vitest'

interface Entry { urlPattern: unknown; handler: string; options: { cacheName: string; networkTimeoutSeconds?: number; expiration?: object } }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withPageNetworkTimeout } = require('./runtime-caching.cjs') as {
  withPageNetworkTimeout: (list: Entry[]) => Entry[]
}

// The shape and order of next-pwa 10's default list (dist/index.d.ts exports it as runtimeCaching).
const rule = (cacheName: string, handler = 'NetworkFirst', extra: object = {}): Entry =>
  ({ urlPattern: () => true, handler, options: { cacheName, expiration: { maxEntries: 32, maxAgeSeconds: 86400 }, ...extra } })
const DEFAULTS: Entry[] = [
  rule('google-fonts-webfonts', 'CacheFirst'),
  rule('static-js-assets', 'StaleWhileRevalidate'),
  rule('next-static-js-assets', 'CacheFirst'),
  rule('apis', 'NetworkFirst', { networkTimeoutSeconds: 10 }),
  rule('pages-rsc-prefetch'),
  rule('pages-rsc'),
  rule('pages'),
  rule('cross-origin', 'NetworkFirst', { networkTimeoutSeconds: 10 }),
]

describe('page caching of the service worker', () => {
  it('falls back to the saved copy when the network does not answer in time', () => {
    const out = withPageNetworkTimeout(DEFAULTS)
    const timeouts = ['pages-rsc-prefetch', 'pages-rsc', 'pages']
      .map((name) => out.find((e) => e.options.cacheName === name)!.options.networkTimeoutSeconds)
    // Short enough that a hung connection shows the saved copy in a few seconds.
    expect(timeouts).toEqual([4, 4, 4])
  })

  it('keeps every rule in its place, so static assets still use their own caches', () => {
    const out = withPageNetworkTimeout(DEFAULTS)
    expect(out.map((e) => e.options.cacheName)).toEqual(DEFAULTS.map((e) => e.options.cacheName))
    expect(out.map((e) => e.handler)).toEqual(DEFAULTS.map((e) => e.handler))
  })

  it('leaves the other rules and the input list untouched', () => {
    const out = withPageNetworkTimeout(DEFAULTS)
    for (const name of ['google-fonts-webfonts', 'static-js-assets', 'next-static-js-assets', 'apis', 'cross-origin']) {
      expect(out.find((e) => e.options.cacheName === name)).toBe(DEFAULTS.find((e) => e.options.cacheName === name))
    }
    expect(DEFAULTS.find((e) => e.options.cacheName === 'pages')!.options.networkTimeoutSeconds).toBeUndefined()
    const pages = out.find((e) => e.options.cacheName === 'pages')!
    expect(pages.urlPattern).toBe(DEFAULTS.find((e) => e.options.cacheName === 'pages')!.urlPattern)
    expect(pages.options.expiration).toEqual({ maxEntries: 32, maxAgeSeconds: 86400 })
  })
})
