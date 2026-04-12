/**
 * Audit — interaction logging and in-app notifications.
 */

import type { AuditLogData } from "./types.ts"
import { supabase }          from "./db-client.ts"

export async function logInteraction(data: AuditLogData): Promise<void> {
  await supabase.from("wa_audit_logs").insert([data])
}

/**
 * Creates an in-app notification for the business dashboard bell.
 * Used to report booking actions (new, reschedule, cancel).
 */
export async function createInternalNotification(
  businessId: string,
  title:      string,
  content:    string,
  type:       "info" | "success" | "warning" | "error" = "info",
  metadata:   Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .insert([{ business_id: businessId, title, content, type, metadata }])

  if (error) {
    throw new Error(`Failed to create internal notification: ${error.message}`)
  }
}
