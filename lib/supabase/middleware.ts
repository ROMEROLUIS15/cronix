import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ── Session timeout constants ─────────────────────────────────────────────
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000   // 30 minutes
const ACTIVITY_COOKIE     = 'cronix_last_activity'

/**
 * Checks if the user has been inactive for more than INACTIVITY_LIMIT_MS.
 * Returns true if the session should be invalidated.
 */
function isInactive(request: NextRequest): boolean {
  const raw = request.cookies.get(ACTIVITY_COOKIE)?.value
  if (!raw) return false                         // first visit — not inactive yet
  const lastActivity = parseInt(raw, 10)
  if (isNaN(lastActivity)) return false
  return Date.now() - lastActivity > INACTIVITY_LIMIT_MS
}

/**
 * Stamps the current timestamp into the activity cookie.
 * Max-Age matches the inactivity window so the cookie auto-expires.
 */
function stampActivity(response: NextResponse): void {
  response.cookies.set(ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   INACTIVITY_LIMIT_MS / 1000,        // seconds
  })
}

/**
 * Clears the activity cookie on forced logout.
 */
function clearActivity(response: NextResponse): void {
  response.cookies.set(ACTIVITY_COOKIE, '', { maxAge: 0, path: '/' })
}

// ── Main session updater ──────────────────────────────────────────────────

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ── Unauthenticated: redirect to login ───────────────────────────────────
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ── Authenticated: enforce inactivity timeout ────────────────────────────
  if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
    if (isInactive(request)) {
      // Sign out server-side and redirect to login with reason param
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'inactivity')
      const redirect = NextResponse.redirect(url)
      clearActivity(redirect)
      return redirect
    }

    // Active session — refresh the activity timestamp
    stampActivity(supabaseResponse)
  }

  // ── Already authenticated: skip login/register ───────────────────────────
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/register')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
