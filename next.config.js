const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // reactStrictMode OFF — en desarrollo ejecutaba cada useEffect 2 veces,
  // duplicando todas las queries a Supabase y causando lentitud perceptible.
  // En producción no tiene efecto, pero en local generaba el doble de requests.
  reactStrictMode: false,

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
