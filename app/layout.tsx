import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Cronix', template: '%s — Cronix' },
  description: 'Plataforma inteligente para gestionar citas, clientes y finanzas.',
  themeColor: '#08080A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}