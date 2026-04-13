// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

export function createAdminClient(): ReturnType<typeof createClient> {
  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
