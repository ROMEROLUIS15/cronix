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
import { useCallback } from 'react'
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
  const queryKey = Array.isArray(key) ? key : [key]
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
