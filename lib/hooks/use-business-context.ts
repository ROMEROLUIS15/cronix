/**
 * useBusinessContext — Client-side hook for auth + business resolution.
 *
 * Priority: reads from ServerBusinessContext (populated by RSC layout).
 * Fallback: if no server context (pages outside dashboard layout), resolves
 *           via React Query + Supabase browser client.
 *
 * Guarantees:
 *  - Zero DB round-trip when inside dashboard layout (data arrives via RSC)
 *  - Still provides supabase browser client for mutations
 *  - Stable reference — no eslint-disable needed for deps
 */

'use client'

import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useServerBusinessContext } from '@/components/providers'

interface UseBusinessContextResult {
  /** The Supabase browser client — stable across renders */
  supabase: ReturnType<typeof createClient>
  /** The authenticated user's business_id, null while loading */
  businessId: string | null
  /** The authenticated user's ID, null while loading */
  userId: string | null
  /** The user's display name for greeting */
  userName: string
  /** The user's role (owner, employee, platform_admin) */
  userRole: string | null
  /** True while the initial auth/business resolution is in progress */
  loading: boolean
}

export function useBusinessContext(): UseBusinessContextResult {
  // Stable supabase client for mutations
  const supabase = useMemo(() => createClient(), [])

  // Fast path: read from server context (populated by dashboard layout RSC)
  const serverCtx = useServerBusinessContext()

  if (serverCtx) {
    // Zero DB round-trip — data arrived pre-rendered from the server
    return {
      supabase,
      businessId: serverCtx.businessId,
      userId:     serverCtx.userId,
      userName:   serverCtx.userName,
      userRole:   serverCtx.userRole,
      loading:    false,
    }
  }

  // Fallback: pages outside dashboard layout (login, register, landing)
  // These pages don't need business context — return empty state
  return {
    supabase,
    businessId: null,
    userId:     null,
    userName:   'Usuario',
    userRole:   null,
    loading:    false,
  }
}
