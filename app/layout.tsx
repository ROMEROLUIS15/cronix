import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { PwaUpdateToast } from '@/components/ui/pwa-update-toast'

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

// ── Metadata ──────────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: {
    default: 'Cronix - Gestión Inteligente',
    template: '%s | Cronix'
  },
  description: 'Gestiona citas, clientes y finanzas de tu negocio en un solo lugar. Diseñado para profesionales que no se conforman.',
  manifest: '/manifest.json',
  keywords: ['agenda', 'citas', 'gestión de clientes', 'crm', 'finanzas', 'supabase', 'whatsapp bot', 'pwa'],
  authors: [{ name: 'Cronix Team' }],
  metadataBase: new URL('https://cronix-app-git-develop-luis-romeros-projects.vercel.app'),
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    url: 'https://cronix-app-git-develop-luis-romeros-projects.vercel.app',
    title: 'Cronix - Gestión Inteligente',
    description: 'La plataforma que centraliza tus citas, clientes y finanzas en una sola App.',
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
    title: 'Cronix - Gestión Inteligente',
    description: 'Centraliza tu negocio con el poder de la IA y WhatsApp.',
    images: ['/og-cronix.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cronix',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`dark ${inter.className}`} suppressHydrationWarning>
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
      <body>
        {children}
        <PwaUpdateToast />
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
