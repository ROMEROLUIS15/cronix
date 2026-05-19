import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'
import type { ReviewedToolName } from '../../_shared/supervisor/contracts.ts'
import type { ToolResult }       from '../types.ts'

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
  /**
   * Constitutional guard. Capabilities call this BEFORE any SQL write.
   * Returns null when allowed; returns a denial ToolResult when the
   * reviewer blocks. Absent ⇒ the runtime is running without a configured
   * GROQ_API_KEY and the write proceeds unreviewed (fail-open by config).
   */
  runWriteGuard?: (
    toolName: ReviewedToolName,
    args:     Readonly<Record<string, unknown>>,
  ) => Promise<ToolResult | null>
}
