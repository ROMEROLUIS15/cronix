/**
 * loading.tsx — Streaming loading fallback for the entire app.
 *
 * Rendered while Server Components fetch data.
 * Uses a subtle skeleton pattern to indicate activity without blocking navigation.
 */

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="text-center">
        {/* Spinner */}
        <div className="inline-block w-10 h-10 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />

        {/* Loading text */}
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Cargando...
        </p>
      </div>
    </div>
  )
}
