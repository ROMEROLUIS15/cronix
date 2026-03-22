'use client'

/**
 * Dashboard Error Boundary — Next.js App Router error.tsx
 *
 * Catches unhandled errors thrown by Server Components and async Server Actions
 * inside the /dashboard segment. Renders a recoverable error UI instead of
 * crashing the entire app.
 *
 * Does NOT catch errors inside Client Components (those should use Result<T>
 * or local error state via useFetch).
 */

import { useEffect } from 'react'
import { AlertCircle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: Props) {
  useEffect(() => {
    // Centralized server-side error logging.
    // Replace with your observability service (Sentry, Datadog, etc.) here.
    console.error('[Dashboard] Unhandled error:', error.message, error.digest)
  }, [error])

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[400px] gap-6 px-4"
      role="alert"
    >
      <div
        className="flex items-center justify-center w-14 h-14 rounded-full"
        style={{ background: 'rgba(255, 59, 48, 0.12)' }}
      >
        <AlertCircle className="w-7 h-7" style={{ color: '#FF3B30' }} />
      </div>

      <div className="text-center space-y-1">
        <p className="text-base font-semibold" style={{ color: '#F5F5F5' }}>
          Algo salió mal
        </p>
        <p className="text-sm" style={{ color: '#8A8A90' }}>
          {error.message ?? 'Error inesperado. Por favor intenta de nuevo.'}
        </p>
      </div>

      <Button onClick={reset} variant="secondary" className="gap-2">
        <RefreshCcw className="w-4 h-4" />
        Reintentar
      </Button>
    </div>
  )
}
