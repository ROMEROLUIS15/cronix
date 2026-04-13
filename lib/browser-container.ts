/**
 * lib/browser-container.ts — Client-side repository container.
 *
 * Mirrors the server-side getContainer() but uses the browser Supabase client
 * so it can be safely imported from 'use client' hooks and components.
 *
 * Do NOT import lib/container here — it pulls in async_hooks (Node.js only).
 */

import { createClient } from '@/lib/supabase/client'
import { getRepos } from '@/lib/repositories'
import type { AppContainer } from '@/lib/container'

let _instance: AppContainer | null = null

/**
 * Returns a browser-side repository container backed by the Supabase browser
 * client. The instance is cached per page load (singleton within a browser tab).
 *
 * Safe to call from 'use client' hooks and components.
 */
export function getBrowserContainer(): AppContainer {
  if (!_instance) {
    const supabase = createClient()
    _instance = getRepos(supabase)
  }
  return _instance
}
