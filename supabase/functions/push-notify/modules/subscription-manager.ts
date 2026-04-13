// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

export function createAdminClient(): ReturnType<typeof createClient> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

export function createUserClient(
  supabaseUrl: string,
  anonKey: string,
  jwt: string
): ReturnType<typeof createClient> {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  })
}

export interface NotificationSubscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export async function fetchSubscriptions(businessId: string): Promise<NotificationSubscription[]> {
  const supabase = createAdminClient()
  const { data: subs, error: subsErr } = await supabase
    .from('notification_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('business_id', businessId)

  if (subsErr) throw new Error(subsErr.message)
  return (subs ?? []) as NotificationSubscription[]
}

export async function purgeExpiredSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('notification_subscriptions')
    .delete()
    .in('endpoint', endpoints)

  if (error) throw new Error(error.message)
}
