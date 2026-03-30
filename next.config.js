const { withSentryConfig } = require('@sentry/nextjs')

const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development", // SW requires production build assets
  register: false,    // Manual registration via RegisterSW component (App Router compatible)
  skipWaiting: false, // Controlled manually via SKIP_WAITING message for One-Click Update
  // Merges worker/index.js into the compiled sw.js — adds push + notificationclick handlers
  customWorkerDir: "worker",
  // next-pwa v5 + Next.js 14 App Router: these manifest files are not served
  // at /_next/* and cause Workbox bad-precaching-response errors at runtime.
  buildExcludes: [/app-build-manifest\.json$/, /middleware-manifest\.json$/],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "ui-avatars.com" },
    ],
  },

  experimental: {
    instrumentationHook: true,
    turbo: {
      rules: {},
    },
    optimizePackageImports: ['lucide-react', 'date-fns', 'date-fns/locale'],
    serverComponentsExternalPackages: ['@simplewebauthn/server'],
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

module.exports = withSentryConfig(withPWA(nextConfig), sentryBuildOptions)
