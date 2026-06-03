/**
 * Shared Supabase service-role client for process-whatsapp.
 * Single instance per cold start — imported by all database modules.
 */

import { createClient } from "@supabase/supabase-js"

// @ts-ignore — Deno runtime global
export const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)
