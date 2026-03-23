/**
 * useBusinessContext — Client-side hook for auth + business resolution.
 *
 * Replaces the duplicated init pattern in 8+ pages:
 *   const supabase = createClient()
 *   useEffect(() => { getUser() → select business_id → setState }, [])
 *
 * Usage:
 *   const { businessId, userId, userName, loading, supabase } = useBusinessContext()
 *
 * Guarantees:
 *  - Auth user is resolved via getUser()
 *  - business_id is fetched from users table
 *  - Provides stable supabase client reference (avoids eslint-disable for deps)
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getBusinessContext, type BusinessContext } from '@/lib/repositories/users.repo'

interface UseBusinessContextResult {
  /** The Supabase browser client — stable across renders */
  supabase: ReturnType<typeof createClient>
  /** The authenticated user's business_id, null while loading */
  businessId: string | null
  /** The authenticated user's ID, null while loading */
  userId: string | null
  /** The user's first name for greeting */
  userName: string
  /** The user's role (owner, employee, platform_admin) */
  userRole: string | null
  /** True while the initial auth/business resolution is in progress */
  loading: boolean
}

export function useBusinessContext(): UseBusinessContextResult {
  // useMemo ensures a stable reference — no more eslint-disable for deps
  const supabase = useMemo(() => createClient(), [])

  const [context, setContext] = useState<BusinessContext | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const ctx = await getBusinessContext(supabase)
      if (!cancelled) {
        setContext(ctx)
        setLoading(false)
      }
    }

    init()
    return () => { cancelled = true }
  }, [supabase])

  return {
    supabase,
    businessId: context?.businessId ?? null,
    userId:     context?.userId ?? null,
    userName:   context?.userName ?? 'Usuario',
    userRole:   context?.userRole ?? null,
    loading,
  }
}
