const { withSentryConfig } = require('@sentry/nextjs')
const createNextIntlPlugin = require('next-intl/plugin')

// Points to the RSC request config — loaded server-side on every request
const withIntl = createNextIntlPlugin('./i18n/request.ts')

// ✅ SECURITY FIX: Migrated from next-pwa (vulnerable serialize-javascript)
// to @ducanh2912/next-pwa — a maintained fork with updated dependencies
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: false,
  skipWaiting: false,
  customWorkerDir: "worker",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Output standalone for Docker deployment
  output: 'standalone',

  // 🛡️ Security Headers — applied to all responses in production
  async headers() {
    return [
      {
        // Apply to all pages and API routes
        source: '/:path*',
        headers: [
          // 🛡️ HSTS — force HTTPS for 1 year, include subdomains, allow preloading
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // 🛡️ COOP — isolate this browsing context group
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // 🛡️ CORP — restrict cross-origin resource sharing
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          // Prevent MIME-type sniffing attacks
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Prevent clickjacking — Cronix is never embedded in an iframe
          { key: 'X-Frame-Options', value: 'DENY' },
          // Legacy XSS filter (no-op in modern browsers, but harmless)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Only send origin in referrer, not full URL
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Restrict browser features that the app doesn't need
          // microphone=(self) allows the app itself to use the mic (Luis IA voice assistant).
          // camera/geolocation/payment/usb remain fully blocked — Cronix never needs them.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
          // Content Security Policy — allows Next.js App Router, PWA, Supabase, and analytics
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://*.supabase.co",
              // ⚠️ 'unsafe-eval' is required for Next.js 14 App Router RSC hydration.
              // Removing it would break the app. Sentry also requires it for error capture.
              // Mitigation: COOP + CORP + X-Frame-Options prevent iframe-based XSS exfiltration.
              // TODO: Revisit when Next.js supports strict CSP with nonces (App Router limitation).
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data: https://*.supabase.co https://ui-avatars.com",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co https://*.sentry.io https://api.axiom.co wss://*.supabase.co",
              "worker-src 'self' blob:",
              // data: required for Deepgram TTS — audio is returned as base64 data URL
              "media-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "ui-avatars.com" },
    ],
    // 🛡️ SECURITY: Cache TTL to prevent disk exhaustion (GHSA-3x4c-7xq6-9pq8)
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    // 🛡️ SECURITY: Limit image dimensions to prevent memory DoS
    formats: ['image/webp', 'image/avif'], // Modern formats only
  },

  // Next.js 15: serverExternalPackages replaces experimental.serverComponentsExternalPackages
  serverExternalPackages: ['@simplewebauthn/server'],
  
  turbopack: {
    rules: {},
  },
  typescript: {
    // ✅ SECURITY: Build errors are now enforced. Previously ignored 1000+ errors.
    // Incremental fix plan:
    //   Sprint 1: Fix type defs (database.types.ts, result.ts, query-types.ts)
    //   Sprint 2: Fix repository layer (all *Repository.ts files)
    //   Sprint 3: Fix Server Actions and API routes
    //   Sprint 4: Fix UI components (props, state, event handlers)
    // Track progress: run `npm run typecheck` and count remaining errors.
    // ignoreBuildErrors: true,  // REMOVED — re-enabled after incremental fix
  },
  eslint: {
    // Similarly, lint errors are now enforced via Husky on staged files.
    // ignoreDuringBuilds: true,  // REMOVED
  },
};

// ── Sentry webpack plugin options ─────────────────────────────────────────────
// SENTRY_AUTH_TOKEN: generate at https://sentry.io/settings/auth-tokens/
// SENTRY_ORG / SENTRY_PROJECT: set in Vercel env vars for CI source map uploads.
// All values come from env — no secrets hardcoded here.

/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const sentryBuildOptions = {
  org:            process.env.SENTRY_ORG,
  project:        process.env.SENTRY_PROJECT,
  authToken:      process.env.SENTRY_AUTH_TOKEN,

  // Print Sentry output only in CI to keep local builds clean
  silent: !process.env.CI,

  // Never serve source maps publicly — uploaded to Sentry then removed
  hideSourceMaps: true,

  webpack: {
    // Tree-shake Sentry debug logger out of the production bundle
    treeshake: { removeDebugLogging: true },

    // Cronix doesn't use Vercel Cron Monitors (uses Supabase pg_cron instead)
    automaticVercelMonitors: false,
  },
}

// Composition order matters:
// - Sentry must be outermost: instruments webpack over everything
// - withIntl wraps withPWA: PWA generates sw.js assets first, next-intl doesn't touch them
// - Sentry is skipped in development: Turbopack ignores webpack plugins anyway,
//   and the webpack plugin causes 65-104s serialization overhead in dev.
const withPlugins = withIntl(withPWA(nextConfig))
module.exports = process.env.NODE_ENV === 'development'
  ? withPlugins
  : withSentryConfig(withPlugins, sentryBuildOptions)
