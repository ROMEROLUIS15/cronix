/**
 * with-user-status.ts — Blocks rejected users from accessing the dashboard.
 *
 * Checks the user's status in the database (cached in a cookie for 5 minutes).
 * If status is "rejected", signs out the user and redirects to login.
 *
 * Only runs on dashboard page navigations (not API routes) to avoid
 * unnecessary DB round-trips on every fetch/server-action call.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { MiddlewareFn } from './compose'
import { STATUS_CACHE_COOKIE, STATUS_CACHE_TTL_S } from './constants'
import { stripLocalePrefix, clearSessionCookies, redirectToLogin } from './utils'

export const withUserStatus: MiddlewareFn = async (req, baseRes, next) => {
  const pathname = stripLocalePrefix(req.nextUrl.pathname)
  const userId = baseRes.headers.get('x-user-id')

  // Only check on dashboard page navigations (skip API routes)
  if (!userId || !pathname.startsWith('/dashboard') || pathname.startsWith('/api/')) {
    return null
  }

  const cachedStatus = req.cookies.get(STATUS_CACHE_COOKIE)?.value

  if (cachedStatus === 'rejected') {
    const response = await signOutAndRedirect(req)
    copyCookies(baseRes, response)
    return response
  }

  if (!cachedStatus) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return [] }, setAll() {} } },
    )

    const { data: dbUser } = await supabase
      .from('users')
      .select('status')
      .eq('id', userId)
      .single()

    const status = dbUser?.status ?? 'unknown'

    if (status === 'rejected') {
      const response = await signOutAndRedirect(req)
      copyCookies(baseRes, response)
      return response
    }

    // Cache non-rejected status for 5 minutes
    baseRes.cookies.set(STATUS_CACHE_COOKIE, status, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // ✅ Prevent cookie theft over HTTP
      sameSite: 'lax',
      path: '/',
      maxAge: STATUS_CACHE_TTL_S,
    })
  }

  return null
}

async function signOutAndRedirect(request: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } },
  )
  await supabase.auth.signOut()
  const redirect = redirectToLogin(request, 'account_blocked')
  clearSessionCookies(redirect)
  return redirect
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.headers.getSetCookie()) {
    to.headers.append('set-cookie', cookie)
  }
}
