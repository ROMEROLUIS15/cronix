const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: false, // Controlled manually via SKIP_WAITING message for One-Click Update
  // Merges worker/index.js into the compiled sw.js — adds push + notificationclick handlers
  customWorkerDir: "worker",
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
