/**
 * Audit — interaction logging.
 */

import type { AuditLogData } from "./types.ts"
import { supabase }          from "./db-client.ts"

export async function logInteraction(data: AuditLogData): Promise<void> {
  await supabase.from("wa_audit_logs").insert([data])
}

