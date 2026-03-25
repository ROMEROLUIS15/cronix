'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

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
