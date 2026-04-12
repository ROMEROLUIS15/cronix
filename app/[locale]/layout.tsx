import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { PwaUpdateToast } from '@/components/ui/pwa-update-toast'
import { captureRequestError } from '@sentry/nextjs'

// ── Generate static params for all locales ───────────────────────────────────
// Tells Next.js about valid [locale] segments at build time.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

// ── Locale layout ─────────────────────────────────────────────────────────────
// Wraps all pages with NextIntlClientProvider so useTranslations() works
// in client components. Server Components get translations via getTranslations().
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // Validate locale — return 404 for unsupported values
  if (!routing.locales.includes(locale as typeof routing.locales[number])) {
    notFound()
  }

  // Load all messages for the active locale
  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
      <PwaUpdateToast />
    </NextIntlClientProvider>
  )
}

// ── Sentry RSC Error Boundary ─────────────────────────────────────────────────
// Captures errors from nested Server Components (RSCs) that are not caught
// by the global error.tsx handler.
export const onRequestError = captureRequestError
