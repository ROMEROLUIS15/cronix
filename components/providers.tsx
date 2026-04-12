'use client'

import { createContext, useContext } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

// ── Business Context — populated by RSC layout, consumed by client hooks ─────
export interface ServerBusinessContextValue {
  businessId: string
  userName: string
  userRole: string
  userId: string
}

const ServerBusinessContext = createContext<ServerBusinessContextValue | null>(null)

/**
 * Provider that wraps the app and receives server-fetched business context.
 * Set by dashboard layout.tsx via the `value` prop.
 */
export function ServerBusinessContextProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: ServerBusinessContextValue | null
}) {
  return (
    <ServerBusinessContext.Provider value={value}>
      {children}
    </ServerBusinessContext.Provider>
  )
}

/** Read-only hook — returns server-provided business context (or null) */
export function useServerBusinessContext(): ServerBusinessContextValue | null {
  return useContext(ServerBusinessContext)
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,      // 5 min — data stays fresh, no refetch on mount
            gcTime: 15 * 60 * 1000,         // 15 min — cache outlives navigation back-forward
            refetchOnWindowFocus: false,     // avoid surprise refetches on tab switch
            refetchOnReconnect: true,        // refresh stale data after network loss
            retry: 1,
            throwOnError: false,
          },
          mutations: {
            retry: 0,                        // mutations never retry automatically
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
