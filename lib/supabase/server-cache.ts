/**
 * server-cache.ts — React.cache() wrappers for repeated Supabase calls.
 *
 * Next.js deduplicates calls to React.cache()-wrapped functions within a single
 * RSC render pass. Layout and page share one result; no extra network round-trips.
 */

import { cache } from 'react'
import { createClient, createAdminClient } from './server'

// One auth.getUser() call per request, shared between layout and page.
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

// One user profile query per request, shared between layout and page.
// Uses admin client to bypass the RLS recursion bug on the users table (affects
// platform_admin and some edge cases with the regular client).
export const getAuthUserProfile = cache(async (userId: string) => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('users')
    .select('name, role, business_id, avatar_url, color, businesses(name, category)')
    .eq('id', userId)
    .single()
  return data
})