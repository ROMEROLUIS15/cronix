'use client'

/**
 * useFetch — Centralized async data-fetching hook.
 *
 * Replaces scattered try/catch + console.error patterns in Client Components.
 * Returns typed loading / data / error state so UI can react accordingly.
 *
 * When the backend is decoupled, only the `fetcher` function changes —
 * the component code stays identical.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useFetch(
 *     () => clientsRepo.getClients(supabase, businessId!),
 *     [supabase, businessId],
 *     { enabled: !!businessId }
 *   )
 */

import { useState, useEffect, useCallback, useRef, type DependencyList } from 'react'
import { toErrorMessage } from '@/types/result'

interface FetchState<T> {
  data:    T | null
  loading: boolean
  error:   string | null
}

interface UseFetchOptions {
  /** Set to false to skip the fetch (e.g. while businessId is null). Defaults to true. */
  enabled?: boolean
}

export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps:    DependencyList,
  options?: UseFetchOptions,
): FetchState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<FetchState<T>>({
    data:    null,
    loading: true,
    error:   null,
  })

  // Prevent state updates after unmount
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const run = useCallback(async () => {
    if (options?.enabled === false) {
      if (mountedRef.current) setState(s => ({ ...s, loading: false }))
      return
    }

    if (mountedRef.current) setState(s => ({ ...s, loading: true, error: null }))

    try {
      const data = await fetcher()
      if (mountedRef.current) setState({ data, loading: false, error: null })
    } catch (e) {
      if (mountedRef.current) {
        setState({ data: null, loading: false, error: toErrorMessage(e) })
      }
    }
  // Intentional: deps are forwarded from the caller, same as useEffect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.enabled, ...deps])

  useEffect(() => {
    run()
  }, [run])

  return { ...state, refetch: run }
}
