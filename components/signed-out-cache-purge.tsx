'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { isSignedOutPath, purgeSignedOutCaches } from '@/lib/pwa/signed-out-cache-purge'

/**
 * Runs on every page, full loads and in-app navigations alike: sign-out ends with a server
 * action redirect, which navigates without reloading the document.
 */
export function SignedOutCachePurge() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname && isSignedOutPath(pathname)) void purgeSignedOutCaches()
  }, [pathname])
  return null
}
