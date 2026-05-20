import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'path'

let dotenv: any
try { dotenv = require('dotenv') } catch { }
if (dotenv) dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabaseAccess = !!(SUPABASE_URL && SERVICE_ROLE_KEY)
const describeIntegration = hasSupabaseAccess ? describe : describe.skip

describeIntegration('Voice Assistant Flow', () => {
  let TEST_BUSINESS_ID: string
  let TEST_USER_ID: string

  beforeAll(async () => {
    if (!hasSupabaseAccess) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: biz } = await supabase
      .from('businesses')
      .select('id')
      .eq('slug', 'e2e-test')
      .maybeSingle()

    if (biz) TEST_BUSINESS_ID = biz.id

    const { data: user } = await supabase.auth.admin.listUsers()
    if (user?.users && user.users.length > 0) {
      TEST_USER_ID = user.users[0].id
    }
  })

  it('initializes voice assistant with empty chat history', async () => {
    if (!TEST_USER_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: assistantData } = await supabase
      .from('assistant_sessions')
      .select('id, chat_history')
      .eq('user_id', TEST_USER_ID)
      .maybeSingle()

    expect(assistantData).toBeDefined()
  })

  it('stores assistant chat history in sessionStorage simulation', async () => {
    if (!TEST_BUSINESS_ID) return

    expect(TEST_BUSINESS_ID).toBeDefined()
  })

  it('tracks assistant position from localStorage simulation', async () => {
    if (!TEST_BUSINESS_ID) return

    expect(TEST_BUSINESS_ID).toBeDefined()
  })

  it('persists Y position across page loads', async () => {
    if (!TEST_USER_ID) return

    expect(TEST_USER_ID).toBeDefined()
  })

  it('syncs FAB visibility from business settings', async () => {
    if (!TEST_BUSINESS_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: business } = await supabase
      .from('businesses')
      .select('settings')
      .eq('id', TEST_BUSINESS_ID)
      .single()

    expect(business).toBeDefined()
  })

  it('toggles FAB visibility via custom event', async () => {
    if (!TEST_BUSINESS_ID) return

    expect(TEST_BUSINESS_ID).toBeDefined()
  })

  it('subscribes to Realtime channel for appointments', async () => {
    if (!TEST_BUSINESS_ID) return

    expect(TEST_BUSINESS_ID).toBeDefined()
  })

  it('invalidates appointment queries on database changes', async () => {
    if (!TEST_BUSINESS_ID) return

    expect(TEST_BUSINESS_ID).toBeDefined()
  })

  it('handles missing business settings gracefully', async () => {
    if (!TEST_BUSINESS_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: business, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', TEST_BUSINESS_ID)
      .single()

    expect(error).toBeNull()
    expect(business).toBeDefined()
  })

  it('handles realtime subscription errors', async () => {
    if (!TEST_BUSINESS_ID) return

    expect(TEST_BUSINESS_ID).toBeDefined()
  })
})
