/**
 * After a sign-out, a slow network made the service worker show the previous user's saved
 * dashboard (independent verifier, 2026-11-05). Landing on the home page or a sign-in screen
 * must delete those saved pages.
 */
import { describe, expect, it } from 'vitest'
import { isSignedOutPath, purgeSignedOutCaches, SIGNED_OUT_CACHE_NAMES } from './signed-out-cache-purge'

describe('pages shown without a session', () => {
  it.each(['/', '/login', '/register', '/forgot-password', '/reset-password', '/invite/ABC123', '/en/login', '/pt', '/es/register'])(
    '%s is one', (path) => { expect(isSignedOutPath(path)).toBe(true) },
  )
  it.each(['/dashboard', '/dashboard/clients', '/en/dashboard', '/privacy', '/terms', '/login-help', '/registered', '/english'])(
    '%s is not', (path) => { expect(isSignedOutPath(path)).toBe(false) },
  )
})

describe('purgeSignedOutCaches', () => {
  it('deletes the caches that hold signed-in pages and API answers', async () => {
    const deleted: string[] = []
    await purgeSignedOutCaches({ delete: async (n: string) => { deleted.push(n); return true } } as unknown as CacheStorage)
    expect(deleted).toEqual([...SIGNED_OUT_CACHE_NAMES])
    expect(deleted).toEqual(expect.arrayContaining(['pages', 'pages-rsc', 'pages-rsc-prefetch', 'apis']))
  })

  it('does nothing without cache storage and survives a failing delete', async () => {
    await expect(purgeSignedOutCaches(undefined)).resolves.toBeUndefined()
    await expect(purgeSignedOutCaches({ delete: async () => { throw new Error('denied') } } as unknown as CacheStorage)).resolves.toBeUndefined()
  })
})
