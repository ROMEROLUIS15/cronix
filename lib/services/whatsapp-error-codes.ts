/**
 * whatsapp-error-codes.ts — which WhatsApp Cloud API send errors are not about
 * one recipient. Pure: no I/O.
 *
 * A "platform" failure (template, account or phone-number level) will repeat for
 * every message of a run, so a bulk sender must stop instead of retrying it.
 * A "recipient" failure is specific to one phone and the run can continue.
 *
 * Source: Meta "WhatsApp error codes" reference (verified 2026-11-20).
 * Spec: docs/specs/modulo-retencion/manifest.md §7 (send failures).
 */

export type MetaFailureScope = 'platform' | 'recipient'

/**
 * Codes that repeat for every message. 131048 is the number-level sending
 * restriction ("too many previous messages were blocked or flagged as spam"):
 * continuing to send from a restricted number only digs the hole deeper.
 */
const PLATFORM_CODES: ReadonlySet<number> = new Set([
  132000, // template: parameter count mismatch
  132001, // template: does not exist in that language, or not approved
  132005, // template: translated text too long
  132007, // template: policy violation
  132012, // template: parameter format mismatch
  132015, // template: paused for low quality
  132016, // template: permanently disabled
  131042, // account: payment method error
  131048, // phone number: sending restrictions
  130429, // account: Cloud API throughput reached
  190,    // account: access token expired
])

/**
 * Anything not listed — recipient codes (131049, 131050, 131026, 131047, 131056),
 * unknown codes and a missing code — stays recipient-scoped, which is the
 * behavior before this classification existed.
 */
export function classifyMetaSendError(code: number | null | undefined): MetaFailureScope {
  return code != null && PLATFORM_CODES.has(code) ? 'platform' : 'recipient'
}
