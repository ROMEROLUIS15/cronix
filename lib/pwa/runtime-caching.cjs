/**
 * Page rules of the service worker get a network timeout. Without it a connection that
 * hangs, connected but answering nothing, left the installed app blank for good although a
 * saved copy existed: measured 30 s+ blank on production and on a local build (2026-11-05).
 *
 * It takes next-pwa's default list and changes only those rules, keeping their order: the
 * service worker uses the first rule that matches, and `pages` matches every same-origin
 * request, so moving it ahead of the static asset rules would send scripts and images to
 * the 32-entry page cache.
 */
const PAGE_NETWORK_TIMEOUT_SECONDS = 4
const PAGE_CACHE_NAMES = ['pages-rsc-prefetch', 'pages-rsc', 'pages']

function withPageNetworkTimeout(defaultRuntimeCaching) {
  return defaultRuntimeCaching.map((entry) => {
    const name = entry.options && entry.options.cacheName
    if (!PAGE_CACHE_NAMES.includes(name)) return entry
    return { ...entry, options: { ...entry.options, networkTimeoutSeconds: PAGE_NETWORK_TIMEOUT_SECONDS } }
  })
}

module.exports = { withPageNetworkTimeout }
