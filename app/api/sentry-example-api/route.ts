import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Test route to verify Sentry captures server-side errors.
 * DELETE THIS FILE after confirming Sentry works in production.
 *
 * Usage: GET /api/sentry-example-api
 */
export function GET() {
  throw new Error("Sentry Example API Route Error — safe to ignore")
  return NextResponse.json({ data: "Testing Sentry Error..." })
}
