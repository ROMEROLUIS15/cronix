import { type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'

// ── next-intl middleware instance ─────────────────────────────────────────────
// Handles locale detection, NEXT_LOCALE cookie, and locale-prefix normalization.
// Configured with 'as-needed' prefix: Spanish users keep /dashboard unchanged;
// other locales receive prefix (/en/dashboard, /fr/login, etc.)
const intlMiddleware = createIntlMiddleware(routing)

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID()

  // ── Step 1: Run next-intl ─────────────────────────────────────────────────
  // Detects locale from URL, cookie, or Accept-Language header.
  // Sets NEXT_LOCALE cookie and x-next-intl-locale request header.
  const intlResponse = intlMiddleware(request)

  // next-intl issues a redirect only for locale-prefix normalization
  // (e.g. /es/dashboard → /dashboard since 'es' is the default locale).
  // In that case, pass it through — no need to run the Supabase session check.
  if (intlResponse.status === 307 || intlResponse.status === 308) {
    intlResponse.headers.set('x-request-id', requestId)
    return intlResponse
  }

  // ── Step 2: Run Supabase session logic ────────────────────────────────────
  // Always pass the ORIGINAL request so Supabase reads the real cookies.
  // updateSession sets sb-* session cookies and handles inactivity / rate-limit.
  const supabaseResponse = await updateSession(request)

  // ── Step 3: Merge next-intl headers onto Supabase response ────────────────
  // The Supabase response is the authoritative response (it owns the redirect
  // decisions and session cookies). We copy next-intl's headers — primarily
  // the NEXT_LOCALE set-cookie and x-next-intl-locale — without overwriting
  // any header that Supabase already set.
  intlResponse.headers.forEach((value, key) => {
    if (!supabaseResponse.headers.has(key)) {
      supabaseResponse.headers.set(key, value)
    }
  })

  supabaseResponse.headers.set('x-request-id', requestId)
  return supabaseResponse
}

export const config = {
  matcher: [
    // next-intl: all page requests except static files and Next.js internals
    '/((?!_next|_vercel|.*\\..*).*)',
    // Supabase rate-limiting and session refresh on API routes
    '/api/:path*',
  ],
}
