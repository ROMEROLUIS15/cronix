import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { getLocale, getTranslations } from 'next-intl/server'
import './globals.css'

// 400 body, 500 emphasised, 600 strong (font-semibold is the most-used heavy
// weight across the app — 197 uses), 700 headings. The previous request for
// 400-900 included two stylistic weights (800/900) that are only used a handful
// of times; the browser synthesises them from 700 without visible degradation,
// shaving ~80 KB off the initial download.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
        <script dangerouslySetInnerHTML={{ __html: `
          console.log('[PWA] Layout script executing');
          (function(){
            // Capture beforeinstallprompt as early as possible
            window.addEventListener('beforeinstallprompt', function(e){
              console.log('[PWA] beforeinstallprompt FIRED - event captured');
              e.preventDefault();
              window.__pwaDeferred = e;
              window.__pwaReady = true;
              // Dispatch custom event so React can react to it
              window.dispatchEvent(new CustomEvent('pwa:prompt-ready'));
            }, true); // Use capture phase for earliest capture

            window.addEventListener('appinstalled', function(){
              console.log('[PWA] appinstalled event fired');
              window.__pwaDeferred = undefined;
              window.__pwaReady = false;
            }, true);
          })();

          // Check PWA criteria
          setTimeout(function(){
            console.log('[PWA] Checking PWA installation criteria:');
            console.log('[PWA] - Manifest:', !!document.querySelector('link[rel="manifest"]'));
            console.log('[PWA] - HTTPS:', location.protocol === 'https:');
            console.log('[PWA] - beforeinstallprompt support:', 'onbeforeinstallprompt' in window);
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.getRegistration().then(reg => {
                console.log('[PWA] - Service Worker:', !!reg, reg ? 'Scope: ' + reg.scope : '');
              });
            }
          }, 100);
        ` }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Script
          id="register-sw"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                ${process.env.NODE_ENV === 'production' ? `
                  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function(){});
                ` : `
                  // En dev: desregistrar cualquier SW legacy (de un build de prod previo)
                  // para que no intercepte respuestas con CSPs viejos cacheados.
                  navigator.serviceWorker.getRegistrations().then(function(regs){
                    regs.forEach(function(r){ r.unregister(); });
                  });
                  if (window.caches) {
                    caches.keys().then(function(keys){
                      keys.forEach(function(k){ caches.delete(k); });
                    });
                  }
                `}
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
