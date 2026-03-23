import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ── Session timeout constants ─────────────────────────────────────────────────
const INACTIVITY_LIMIT_MS  = 30 * 60 * 1000        // 30 minutes
const MAX_SESSION_MS       = 12 * 60 * 60 * 1000   // 12 hours

const ACTIVITY_COOKIE      = 'cronix_last_activity'
const SESSION_START_COOKIE = 'cronix_session_start'

// ── Paths where activity is tracked ──────────────────────────────────────────
function isTrackedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard') ||
    pathname === '/api/activity/ping'
  )
}

// ── Inactivity check ─────────────────────────────────────────────────────────
/**
 * Returns true when the 30-min inactivity window has been exceeded.
 *
 * Key rule: if cronix_session_start exists but cronix_last_activity is
 * missing, the activity cookie auto-expired — the user IS inactive.
 * Only treat "no activity cookie" as "first visit" when there is also
 * no session start cookie.
 */
function isInactive(request: NextRequest): boolean {
  const raw          = request.cookies.get(ACTIVITY_COOKIE)?.value
  const sessionStart = request.cookies.get(SESSION_START_COOKIE)?.value

  if (!raw) {
    // Session started but activity cookie expired → user is inactive
    return !!sessionStart
  }

  const lastActivity = parseInt(raw, 10)
  if (isNaN(lastActivity)) return false
  return Date.now() - lastActivity > INACTIVITY_LIMIT_MS
}

// ── 12-hour absolute session check ───────────────────────────────────────────
function isMaxSessionExpired(request: NextRequest): boolean {
  const raw = request.cookies.get(SESSION_START_COOKIE)?.value
  if (!raw) return false
  const start = parseInt(raw, 10)
  if (isNaN(start)) return false
  return Date.now() - start > MAX_SESSION_MS
}

// ── Stamp activity (and session start if not yet set) ─────────────────────────
function stampActivity(response: NextResponse, request: NextRequest): void {
  response.cookies.set(ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   INACTIVITY_LIMIT_MS / 1000,
  })

  // Session start is set once and never renewed — it anchors the 12h hard limit
  if (!request.cookies.get(SESSION_START_COOKIE)?.value) {
    response.cookies.set(SESSION_START_COOKIE, String(Date.now()), {
      httpOnly: true,
      sameSite: 'lax',
      path:     '/',
      maxAge:   (MAX_SESSION_MS / 1000) + 3600, // +1h buffer so it outlives the limit check
    })
  }
}

// ── Clear both session cookies on forced logout ───────────────────────────────
function clearActivity(response: NextResponse): void {
  response.cookies.set(ACTIVITY_COOKIE,      '', { maxAge: 0, path: '/' })
  response.cookies.set(SESSION_START_COOKIE, '', { maxAge: 0, path: '/' })
}

// ── Main session updater ──────────────────────────────────────────────────────
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

  // ── Unauthenticated: redirect to login ────────────────────────────────────
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ── Status enforcement: block rejected users ──────────────────────────────
  if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const { data: dbUser } = await supabase
      .from('users')
      .select('status')
      .eq('id', user.id)
      .single()

    if (dbUser?.status === 'rejected') {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'account_blocked')
      const redirect = NextResponse.redirect(url)
      clearActivity(redirect)
      return redirect
    }
  }

  // ── Authenticated on a tracked path: enforce session limits ───────────────
  if (user && isTrackedPath(request.nextUrl.pathname)) {

    // 1. Hard 12-hour absolute limit — checked before inactivity
    if (isMaxSessionExpired(request)) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'session_expired')
      const redirect = NextResponse.redirect(url)
      clearActivity(redirect)
      return redirect
    }

    // 2. 30-minute inactivity limit
    if (isInactive(request)) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'inactivity')
      const redirect = NextResponse.redirect(url)
      clearActivity(redirect)
      return redirect
    }

    // 3. Active session — refresh activity timestamp
    stampActivity(supabaseResponse, request)
  }

  // ── Already authenticated: skip login/register ────────────────────────────
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
