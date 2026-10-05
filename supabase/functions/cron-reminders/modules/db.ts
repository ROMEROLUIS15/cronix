import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function createAdminClient(): SupabaseClient {
  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
