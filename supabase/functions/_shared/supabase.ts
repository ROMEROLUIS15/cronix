import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

/**
 * Shared Supabase Client for Edge Functions.
 * Uses SERVICE_ROLE_KEY to ensure maintenance operations (like DLQ logging) 
 * can always execute regardless of RLS on other tables.
 */
export function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    }
  })
}

/**
 * Logs a failed payload to the Dead Letter Queue.
 */
export async function logToDLQ(payload: any, error: any, service: string = 'whatsapp') {
  try {
    const supabase = getAdminClient()
    const errorMsg = error instanceof Error ? error.message : String(error)
    
    const { error: dbError } = await supabase
      .from('wa_dead_letter_queue')
      .insert({
        payload,
        error: errorMsg,
        service_type: service
      })

    if (dbError) {
      console.error(`[DLQ-ERROR] Failed to insert into DLQ: ${dbError.message}`)
    } else {
      console.log(`[DLQ-SUCCESS] Payload saved to DLQ for service: ${service}`)
    }
  } catch (criticalErr) {
    console.error("[DLQ-CRITICAL] Global failure in DLQ logger", criticalErr)
  }
}
