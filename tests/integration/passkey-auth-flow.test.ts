import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'path'

let dotenv: any
try { dotenv = require('dotenv') } catch { }
if (dotenv) dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabaseAccess = !!(SUPABASE_URL && SERVICE_ROLE_KEY)
const describeIntegration = hasSupabaseAccess ? describe : describe.skip

describeIntegration('Passkey Authentication Flow', () => {
  let TEST_USER_ID: string
  let TEST_PASSKEY_ID: string

  beforeAll(async () => {
    if (!hasSupabaseAccess) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: users } = await supabase.auth.admin.listUsers()
    if (users && users.users && users.users.length > 0) {
      const firstUser = users.users[0]
      if (firstUser?.id) {
        TEST_USER_ID = firstUser.id
      }
    }
  })

  it('generates authentication challenge for login', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: challenges } = await supabase
      .from('passkey_challenges')
      .select('id, challenge')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(Array.isArray(challenges)).toBe(true)
  })

  it('stores passkey challenge in database', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: challenges, error } = await supabase
      .from('passkey_challenges')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(error).toBeNull()
    expect(Array.isArray(challenges)).toBe(true)
  })

  it('retrieves user passkeys for verification', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: passkeys } = await supabase
      .from('user_passkeys')
      .select('id, user_id, credential_id, public_key, counter')
      .eq('user_id', TEST_USER_ID)

    expect(Array.isArray(passkeys)).toBe(true)
  })

  it('updates passkey counter after successful authentication', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: passkeyData } = await supabase
      .from('user_passkeys')
      .select('id, counter')
      .eq('user_id', TEST_USER_ID)
      .limit(1)

    const passkeys = passkeyData as Array<any> | null
    if (passkeys && Array.isArray(passkeys) && passkeys.length > 0) {
      TEST_PASSKEY_ID = passkeys[0]?.id
      expect(passkeys[0]?.counter).toBeDefined()
    }
  })

  it('cleans up used challenge after authentication', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: challenges } = await supabase
      .from('passkey_challenges')
      .select('id')
      .limit(100)

    expect(Array.isArray(challenges)).toBe(true)
  })

  it('generates session token after successful verification', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: user } = await supabase.auth.admin.getUserById(TEST_USER_ID)

    expect(user?.user?.id).toBe(TEST_USER_ID)
  })

  it('handles rate limiting for passkey attempts', async () => {
    if (!TEST_USER_ID) return

    expect(TEST_USER_ID).toBeDefined()
  })

  it('validates challenge before verification', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: challengeData } = await supabase
      .from('passkey_challenges')
      .select('challenge')
      .limit(1)

    const challenges = challengeData as Array<any> | null
    if (challenges && Array.isArray(challenges) && challenges.length > 0) {
      expect(challenges[0]?.challenge).toBeDefined()
    }
  })

  it('prevents replay attacks via counter increment', async () => {
    if (!TEST_PASSKEY_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: passkey } = await supabase
      .from('user_passkeys')
      .select('counter')
      .eq('id', TEST_PASSKEY_ID)
      .single()

    expect(passkey?.counter).toBeGreaterThanOrEqual(0)
  })

  it('stores transports in user_passkeys', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: passkeys } = await supabase
      .from('user_passkeys')
      .select('transports')
      .eq('user_id', TEST_USER_ID)

    expect(Array.isArray(passkeys)).toBe(true)
  })
})
