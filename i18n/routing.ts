import { defineRouting } from 'next-intl/routing'

// ── Single source of truth for locale configuration ───────────────────────────
// Consumed by: middleware.ts, i18n/request.ts, i18n/navigation.ts
// Italian added: high-value vertical (barberías, estéticas, spas) in Italy + Italian communities in LATAM

export const routing = defineRouting({
  locales: ['es', 'en', 'pt', 'fr', 'de', 'it'],
  defaultLocale: 'es',
  // Spanish users keep existing URLs (/dashboard, /login)
  // Other locales receive prefix (/en/dashboard, /fr/login)
  localePrefix: 'as-needed',
})

export type Locale = (typeof routing.locales)[number]
