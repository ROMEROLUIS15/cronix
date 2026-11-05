/**
 * Deletes the saved pages and API answers whenever the landing page or a sign-in screen is
 * shown (/, /login, /register, /forgot-password, /reset-password, /invite/…, with or without
 * a locale prefix).
 *
 * The service worker keeps server-rendered pages of the signed-in user and, when the network
 * does not answer in time, shows them. Every way out of a session ends on one of these pages
 * (sign-out goes to /, an expired or disabled session to /login), and every new user of the
 * same device passes through one of them, so nobody is shown the previous user's saved page.
 */
export const SIGNED_OUT_CACHE_NAMES = ['pages', 'pages-rsc', 'pages-rsc-prefetch', 'apis', 'next-data'] as const

const LOCALE_PREFIX = /^\/(?:es|en|pt|fr|de|it)(?=\/|$)/
const SIGNED_OUT_PATH = /^\/(?:$|login$|register$|forgot-password$|reset-password$|invite(?:\/|$))/

export function isSignedOutPath(pathname: string): boolean {
  const path = pathname.replace(LOCALE_PREFIX, '') || '/'
  return SIGNED_OUT_PATH.test(path)
}

export async function purgeSignedOutCaches(storage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  if (!storage) return
  await Promise.all(SIGNED_OUT_CACHE_NAMES.map((name) => storage.delete(name).catch(() => false)))
}
