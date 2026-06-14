/**
 * types.ts — Domain types, ports and defaults for the retention / win-back module.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md (§2, §4).
 * The use cases depend only on these contracts — never on Supabase, HTTP or the
 * concrete Edge Function.
 */

import type { Result } from '@/types/result'

// ── Defaults (modulo-retencion §2, §3) ───────────────────────────────────────
//
// antiSpamDays is NOT configurable in v1 (not part of settings.retention); it is
// a fixed guard. dailyCap IS configurable via settings.retention.dailyCap and
// this is only the fallback when unset.
export const RETENTION_DEFAULTS = {
  antiSpamDays: 30,
  dailyCap: 50,
} as const

// ── GetEligibleClientsUseCase ─────────────────────────────────────────────────

export interface GetEligibleClientsInput {
  businessId: string
}

/** A client ready to be re-engaged (domain shape, camelCase). */
export interface EligibleClient {
  id: string
  name: string
  phone: string
  lastCompletedAt: string | null
}

// ── ProcessRetentionUseCase ───────────────────────────────────────────────────

export interface ProcessRetentionInput {
  businessId: string
}

export interface ProcessRetentionResult {
  /** Templates sent successfully. */
  sent: number
  /** Sends that failed (messenger error). */
  failed: number
  /** True when candidates exceeded dailyCap and the rest were left for the next run. */
  capped: boolean
}

// ── Outbound WhatsApp port (win-back template) ────────────────────────────────

export interface SendWinbackParams {
  /** Destination phone — any format; the adapter/Edge Function strips non-digits. */
  to: string
  clientName: string
  businessName: string
}

/**
 * Port for sending the approved Meta win-back template (HSM). The concrete
 * adapter wraps the WhatsApp Edge Function with `template: 'client_winback'`.
 * Returns Result<void> — never throws.
 */
export interface IRetentionMessenger {
  sendWinback(params: SendWinbackParams): Promise<Result<void>>
}
