"use client"

import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

/**
 * Global error boundary for Next.js App Router.
 *
 * Catches unhandled React rendering errors that bubble past all
 * nested error.tsx boundaries. Reports them to Sentry with the
 * error digest for server-side correlation.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        {/* statusCode={0} renders the generic "Application error" page */}
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
