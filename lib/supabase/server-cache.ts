/**
 * server-cache.ts — React.cache() wrappers for repeated Supabase calls.
 *
 * Next.js deduplicates calls to React.cache()-wrapped functions within a single
 * RSC render pass. Layout and page share one result; no extra network round-trips.
 */

import { cache } from 'react'
import { createClient, createAdminClient } from './server'

// getCachedSessionUser — Cheap, middleware-trusting identity read (NOT validated here).
//
// One user lookup per request, shared between layout and page via React.cache().
//
// We use `auth.getSession()` (local cookie decode, ~1ms) instead of
// `auth.getUser()` (network call to Supabase auth, ~100-200ms). The middleware
// in `lib/middleware/with-session.ts` already invokes `getUser()` and rejects
// requests whose JWT is invalid or expired, so by the time RSC runs the session
// is guaranteed authentic. Doing a second network round-trip here just to
// re-validate the same token wastes ~150ms on every dashboard navigation.
//
// SECURITY CONTRACT: this accessor does NOT validate the JWT itself — it trusts
// that the middleware ran first. It is therefore ONLY safe under `/dashboard/**`
// (and any other route the middleware guards). On surfaces NOT covered by the
// middleware, use `getVerifiedSession()` (`lib/auth/get-session.ts`) instead,
// which calls `auth.getUser()` and validates the token server-side.
//
// Keep these two behaviors in lock-step: if the middleware ever stops
// revalidating tokens, this must switch to `auth.getUser()`.
export const getCachedSessionUser = cache(async () => {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
})

// One user profile query per request, shared between layout and page.
// Uses admin client to bypass the RLS recursion bug on the users table (affects
// platform_admin and some edge cases with the regular client).
export const getCachedUserProfile = cache(async (userId: string) => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('users')
    .select('name, role, business_id, avatar_url, color, businesses(name, category)')
    .eq('id', userId)
    .single()
  return data
})
