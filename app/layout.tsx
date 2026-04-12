import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { getLocale, getTranslations } from 'next-intl/server'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

// ── Viewport separado (Next.js 14+ best practice) ────────────────────────────
export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  /*
    NOTE: viewportFit:'cover' was intentionally NOT set here.
    Setting it causes env(safe-area-inset-top) on <body> to become
    non-zero (e.g. 44px on iPhone), which pushes the 100vh dashboard
    shell below the visible screen bottom — hiding the bottom nav.
    The 80px fixed fallback in globals.css covers all Android nav bars
    without needing viewport-fit:cover.
  */
}

// ── Dynamic Base URL for Metadata ──────────────────────────────────────────
const baseUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://cronix-app.vercel.app' // Fallback oficial de producción

// ── Dynamic per-locale metadata ───────────────────────────────────────────────
// OG locale format mapping: next-intl locale → OpenGraph locale string
const OG_LOCALE_MAP: Record<string, string> = {
  es: 'es_ES',
  en: 'en_US',
  pt: 'pt_BR',
  fr: 'fr_FR',
  de: 'de_DE',
  it: 'it_IT',
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const t = await getTranslations({ locale, namespace: 'meta' })
  const ogLocale = OG_LOCALE_MAP[locale] ?? locale

  return {
    title: {
      default: t('title'),
      template: '%s | Cronix'
    },
    description: t('description'),
    manifest: '/manifest.json',
    keywords: ['agenda', 'appointments', 'citas', 'gestión de clientes', 'crm', 'finanzas', 'supabase', 'whatsapp bot', 'pwa'],
    authors: [{ name: 'Cronix Team' }],
    metadataBase: new URL(baseUrl),
    openGraph: {
      type: 'website',
      locale: ogLocale,
      url: baseUrl,
      title: t('ogTitle'),
      description: t('ogDescription'),
      siteName: 'Cronix',
      images: [
        {
          url: '/og-cronix.png',
          width: 1200,
          height: 630,
          alt: 'Cronix - Gestión Inteligente Dashboard',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('twitterDescription'),
      images: ['/og-cronix.png'],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: 'Cronix',
    },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale} className={`dark ${inter.className}`} suppressHydrationWarning>
      {/*
        Capture beforeinstallprompt before any JS bundle loads.
        Chrome fires this event very early in the page lifecycle — before
        React hydrates. This inline script stores the event in window.__pwaDeferred
        so the usePwaInstall hook can pick it up immediately on mount.
      */}
      <head>
        <link rel="icon" href="/icon.png?v=2" />
        <script dangerouslySetInnerHTML={{ __html:
          `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaDeferred=e;});`
        }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Script
          id="register-sw"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function(){});
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
