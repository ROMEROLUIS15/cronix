'use client'

/**
 * not-found.tsx — Custom 404 page with Cronix branding.
 *
 * Rendered when:
 *  - User navigates to a non-existent route
 *  - A link points to a deleted resource
 */

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="text-center px-6">
        <div className="mb-6">
          <span className="text-8xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            404
          </span>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
          Página no encontrada
        </h1>

        <p className="text-slate-600 dark:text-slate-400 mb-8 max-w-md mx-auto">
          La página que buscas no existe o fue movida. Es posible que el enlace esté roto o que el recurso haya sido eliminado.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Ir al Dashboard
          </Link>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Volver atrás
          </button>
        </div>
      </div>
    </div>
  )
}
