/**
 * tests/e2e/global-setup.ts
 *
 * Playwright globalSetup — runs once before all test suites.
 *
 * Guarantees the E2E test user exists in public.users with role = platform_admin.
 * This mirrors what setup-e2e-data.ts does for the full data seed, but is scoped
 * to just the role update so Playwright can self-recover when CI skips the seed step.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (already needed by setup-e2e-data.ts).
 * If the key is absent, the function exits cleanly — tests will just fail naturally
 * if the role assumption is wrong.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

export default async function globalSetup() {
  const supabaseUrl        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const testEmail          = process.env.E2E_TEST_EMAIL ?? 'test-e2e@cronix.com'

  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('[global-setup] SUPABASE_SERVICE_ROLE_KEY not set — skipping role enforcement')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Find the E2E auth user by email
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr || !list) {
    console.warn('[global-setup] Could not list users:', listErr?.message)
    return
  }

  const authUser = list.users.find((u) => u.email === testEmail)
  if (!authUser) {
    console.warn(`[global-setup] E2E user ${testEmail} not found — run npm run e2e:setup first`)
    return
  }

  // Ensure the public.users row has role = platform_admin
  const { error } = await supabase
    .from('users')
    .update({ role: 'platform_admin' })
    .eq('id', authUser.id)

  if (error) {
    console.warn('[global-setup] Could not update user role:', error.message)
  } else {
    console.log(`[global-setup] ✅ ${testEmail} role confirmed as platform_admin`)
  }
}
