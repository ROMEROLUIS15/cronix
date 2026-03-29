import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Cached server-side helper to resolve the current user's businessId.
 * Uses React `cache()` to deduplicate within the same request — safe to call
 * from both layout and page without extra round trips.
 */
export const getBusinessId = cache(async (): Promise<string | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .single()

  return data?.business_id ?? null
})
