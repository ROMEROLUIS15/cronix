import type { Metadata, Viewport } from 'next'
import './globals.css'

// ── Viewport separado (Next.js 14+ best practice) ────────────────────────────
export const viewport: Viewport = {
  themeColor: '#08080A',
  width: 'device-width',
  initialScale: 1,
  /*
    viewportFit: 'cover' is REQUIRED for env(safe-area-inset-*) to return
    non-zero values on iOS notched devices and Android gesture-nav phones.
    Without this, the browser constrains the layout above the system chrome
    and all safe-area env vars are 0 — causing content to be clipped at the
    bottom behind the Android nav bar on some devices.
  */
  viewportFit: 'cover',
}

// ── Metadata ──────────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: { default: 'Cronix', template: '%s – Cronix' },
  description: 'Plataforma inteligente para gestionar citas, clientes y finanzas.',
  icons: {
    icon: '/favicon.ico',
    apple: '/web-app-manifest-192x192.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
