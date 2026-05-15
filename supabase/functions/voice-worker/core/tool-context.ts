import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

export interface ToolContext {
  // deno-lint-ignore no-explicit-any
  supabase:    SupabaseClient<any>
  businessId:  string
  userId:      string
  timezone:    string
  workingHours?: Record<string, { open: string; close: string } | null>
  /**
   * Concatenated user-side text from this turn + recent history. Used by
   * anti-hallucination guards (service_name, client_name) to verify the LLM
   * didn't invent identifiers the user never said.
   */
  userTextCorpus?: string
}
