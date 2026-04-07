import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'

// ── Strip locale prefix from pathname ─────────────────────────────────────────
// With localePrefix: 'as-needed', non-default locales arrive as /en/dashboard.
// All path-matching logic in this file expects /dashboard — strip the prefix so
// isAuthPath, isAPIPath, isTrackedPath and all direct comparisons work correctly.
function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1) || '/'
    }
  }
  return pathname
}

// ── Session timeout constants ─────────────────────────────────────────────────
const INACTIVITY_LIMIT_MS  = 30 * 60 * 1000        // 30 minutes
const MAX_SESSION_MS       = 12 * 60 * 60 * 1000   // 12 hours

const ACTIVITY_COOKIE      = 'cronix_last_activity'
const SESSION_START_COOKIE = 'cronix_session_start'
const STATUS_CACHE_COOKIE  = 'cronix_user_status'
const STATUS_CACHE_TTL_S   = 5 * 60                   // 5 minutes
const AUTH_RATE_LIMIT_MS   = 60 * 1000                // 1 minute window
const MAX_AUTH_ATTEMPTS    = 5                        // 5 attempts/min
const API_RATE_LIMIT_MS    = 60 * 1000                // 1 minute window
const MAX_API_REQUESTS     = 60                       // 60 requests/min

// ── Rate limit target paths ──────────────────────────────────────────────────
function isAuthPath(pathname: string): boolean {
  return [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ].includes(pathname)
}

function isAPIPath(pathname: string): boolean {
  // Protect all API routes except the activity heartbeat
  return pathname.startsWith('/api/') && pathname !== '/api/activity/ping'
}

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
  response.cookies.set(STATUS_CACHE_COOKIE,  '', { maxAge: 0, path: '/' })
}

// ── Fast path: skip auth round-trip when no session cookies present ───────────
function hasSessionCookies(request: NextRequest): boolean {
  return request.cookies.getAll().some(c => c.name.startsWith('sb-'))
}

// ── Extract Client IP ─────────────────────────────────────────────────────────
function getClientIP(request: NextRequest): string {
  const xForwardedFor = request.headers.get('x-forwarded-for')
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0] ?? 'unknown'
  }
  return '127.0.0.1'
}

// ── Main session updater ──────────────────────────────────────────────────────
export async function updateSession(request: NextRequest) {
  const { pathname: rawPathname } = request.nextUrl
  const pathname = stripLocalePrefix(rawPathname)

  // ── 0. Web Rate Limiting (Security Layer) ───────────────────────────────
  const isAuth = isAuthPath(pathname)
  const isApi  = isAPIPath(pathname)

  if (isAuth || isApi) {
    const ip = getClientIP(request)
    const limit = isAuth ? MAX_AUTH_ATTEMPTS  : MAX_API_REQUESTS
    const window = isAuth ? AUTH_RATE_LIMIT_MS : API_RATE_LIMIT_MS

    const tempClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return [] }, setAll() {} } }
    )

    const { data: allowed, error: rateError } = await tempClient.rpc('fn_web_check_rate_limit', {
      p_identifier:  ip,
      p_window_secs: window / 1000,
      p_max_req:     limit
    })

    if (rateError) {
      console.error('[Middleware] Rate limit RPC error:', rateError)
    } else if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a minute.' },
        { status: 429 }
      )
    }
  }

  // Fast path — no Supabase cookies means unauthenticated user.
  // Skip the network round-trip to auth server entirely.
  if (!hasSessionCookies(request)) {
    if (pathname.startsWith('/dashboard')) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return NextResponse.next({ request })
  }

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

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  // Token stale detectado — limpiar cookies de sesión de Cronix
  // para evitar retry loops del SDK en requests subsiguientes.
  if (authError && !user) {
    supabaseResponse.cookies.set(ACTIVITY_COOKIE, '', { maxAge: 0, path: '/' })
    supabaseResponse.cookies.set(SESSION_START_COOKIE, '', { maxAge: 0, path: '/' })
    supabaseResponse.cookies.set(STATUS_CACHE_COOKIE, '', { maxAge: 0, path: '/' })
  }

  // ── Unauthenticated: redirect to login ────────────────────────────────────
  if (!user && pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ── Status enforcement: block rejected users ──────────────────────────────
  // Only on dashboard page navigations — skip API routes to avoid extra
  // DB round-trip on every server action / fetch call.
  // Status is cached in a cookie for 5 minutes to avoid querying on every navigation.
  const isDashboardPage = user &&
    pathname.startsWith('/dashboard') &&
    !pathname.startsWith('/api/')

  if (isDashboardPage) {
    const cachedStatus = request.cookies.get(STATUS_CACHE_COOKIE)?.value

    if (cachedStatus === 'rejected') {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'account_blocked')
      const redirect = NextResponse.redirect(url)
      clearActivity(redirect)
      return redirect
    }

    // No cache or cache expired → query DB and cache result
    if (!cachedStatus) {
      const { data: dbUser } = await supabase
        .from('users')
        .select('status')
        .eq('id', user.id)
        .single()

      const status = dbUser?.status ?? 'unknown'

      if (status === 'rejected') {
        await supabase.auth.signOut()
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        url.searchParams.set('reason', 'account_blocked')
        const redirect = NextResponse.redirect(url)
        clearActivity(redirect)
        return redirect
      }

      // Cache non-rejected status for 5 minutes
      supabaseResponse.cookies.set(STATUS_CACHE_COOKIE, status, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: STATUS_CACHE_TTL_S,
      })
    }
  }

  // ── Authenticated on a tracked path: enforce session limits ───────────────
  if (user && isTrackedPath(pathname)) {

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
    (pathname === '/login' ||
      pathname === '/register')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
