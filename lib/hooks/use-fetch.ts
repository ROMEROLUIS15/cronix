'use client'

/**
 * useFetch — Centralized async data-fetching hook backed by React Query.
 *
 * Drop-in replacement with the same API surface. Benefits:
 *  - Cached: navigating away and back reuses data instead of re-fetching
 *  - Deduplicated: multiple components with the same key share one request
 *  - Background refetch: stale data shown instantly while fresh data loads
 *
 * Usage:
 *   const { data, loading, error, refetch } = useFetch(
 *     'clients',
 *     () => clientsRepo.getClients(supabase, businessId!),
 *     { enabled: !!businessId }
 *   )
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { toErrorMessage } from '@/types/result'

interface UseFetchOptions {
  /** Set to false to skip the fetch (e.g. while businessId is null). Defaults to true. */
  enabled?: boolean
  /** Cache time in ms before data is considered stale. Defaults to 5 min. */
  staleTime?: number
}

interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useFetch<T>(
  key: string | string[],
  fetcher: () => Promise<T>,
  options?: UseFetchOptions,
): UseFetchResult<T> {
  // Stable key reference — prevents refetch from being recreated on every render
  // when callers pass a constant string like useFetch('clients', ...)
  const keyStr = Array.isArray(key) ? key.join('\0') : key
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queryKey = useMemo(() => Array.isArray(key) ? key : [key], [keyStr])
  const queryClient = useQueryClient()

  const { data, isLoading, error: queryError } = useQuery<T, Error>({
    queryKey,
    queryFn: fetcher,
    enabled: options?.enabled !== false,
    staleTime: options?.staleTime,
  })

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const error = queryError ? toErrorMessage(queryError) : null

  return {
    data: data ?? null,
    loading: isLoading,
    error,
    refetch,
  }
}
