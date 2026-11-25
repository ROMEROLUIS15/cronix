/**
 * types.ts — Domain types, ports and defaults for the retention / win-back module.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md (§2, §4).
 * The use cases depend only on these contracts — never on Supabase, HTTP or the
 * concrete Edge Function.
 */

// ── Defaults (modulo-retencion §2, §3) ───────────────────────────────────────
//
// There is no fixed number of days: the owner's own number decides who has gone
// too long without a visit and how long to wait before writing again.
//
// The daily limits are the platform's, the same for every business (no
// per-business setting). Every business shares one WhatsApp number, which Meta
// allows 250 business-initiated conversations per 24 h while the business
// portfolio is unverified. Win-back takes at most 15% of that (37) so reminders
// and owner alerts always have room; each business sends at most 3 a day, which
// is about what a business with a handful of appointments a day can take in.
export const RETENTION_LIMITS = {
  perBusinessDaily: 3,
  platformDaily: 37,
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
  /** What is left of the platform's daily budget; the business sends at most this many. */
  maxSends?: number
}

export interface ProcessRetentionResult {
  /** Templates sent successfully. */
  sent: number
  /** Sends that failed (messenger error). */
  failed: number
  /** True when candidates exceeded dailyCap and the rest were left for the next run. */
  capped: boolean
  /**
   * Present only when the run stopped early on a platform-wide failure (template
   * missing, account restricted…). Absent on a run that completed.
   */
  aborted?: WinbackFailure
}

// ── Outbound WhatsApp port (win-back template) ────────────────────────────────

export interface SendWinbackParams {
  /** Destination phone — any format; the adapter/Edge Function strips non-digits. */
  to: string
  clientName: string
  businessName: string
  /** Owner of the message, so its delivery status can be traced back. */
  businessId: string
  /** The client the message goes to. */
  clientId: string
}

/**
 * Why a send failed, in terms the use case can act on without knowing Meta.
 * `platform`: it will fail for every client (template, account, phone number) —
 * the run must stop. `recipient`: only this client — the run continues.
 */
export interface WinbackFailure {
  scope: 'platform' | 'recipient'
  /** Provider error code, null when the provider gave none. */
  code: number | null
  /** Template that was being sent. */
  template: string
  message: string
}

/**
 * Outcome of one send. A discriminated union, not Result<void>: Result carries a
 * plain string and cannot say whether the failure should stop the run.
 */
export type SendWinbackResult = { ok: true } | { ok: false; failure: WinbackFailure }

/**
 * Port for sending the approved Meta win-back template (HSM). The concrete
 * adapter wraps the WhatsApp Edge Function with `template: 'client_winback'`.
 * Never throws.
 */
export interface IRetentionMessenger {
  sendWinback(params: SendWinbackParams): Promise<SendWinbackResult>
}
