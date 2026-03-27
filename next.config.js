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
    turbo: {
      rules: {},
    },
    serverComponentsExternalPackages: ['@simplewebauthn/server'],
  },
};

module.exports = withPWA(nextConfig);
