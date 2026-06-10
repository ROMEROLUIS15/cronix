import type {
  IReviewer,
  ReviewMemorySnippet,
  ReviewRejectionCode,
  ReviewRequest,
  ReviewSeverity,
  ReviewedToolName,
  TenantScope,
} from './contracts.ts'

/**
 * Duplicated byte-for-byte under `supabase/functions/_shared/supervisor/guard.ts`
 * (modulo the .ts suffix Deno requires on relative imports). A parity test
 * detects drift.
 */

export interface GuardInput {
  readonly reviewer:      IReviewer
  readonly toolName:      ReviewedToolName
  readonly args:          Readonly<Record<string, unknown>>
  readonly scope:         TenantScope
  readonly userUtterance: string
  readonly recentMemory:  ReadonlyArray<ReviewMemorySnippet>
  readonly timeoutMs?:    number
}

export type GuardOutcome =
  | { readonly allowed: true }
  | {
      readonly allowed:  false
      readonly severity: ReviewSeverity
      readonly code:     ReviewRejectionCode
      readonly reason:   string
    }

export async function reviewWriteOrFailOpen(input: GuardInput): Promise<GuardOutcome> {
  if (!Array.isArray(input.recentMemory)) {
    throw new TypeError('reviewWriteOrFailOpen: recentMemory must be an array (recall is mandatory)')
  }

  const request: ReviewRequest = {
    toolName:      input.toolName,
    toolArgs:      input.args,
    scope:         input.scope,
    userUtterance: input.userUtterance,
    recentMemory:  input.recentMemory,
  }

  const verdict = await input.reviewer.review(request, { timeoutMs: input.timeoutMs })
  if (verdict.ok)                     return { allowed: true }
  if (verdict.severity !== 'block')   return { allowed: true }

  return {
    allowed:  false,
    severity: verdict.severity,
    code:     verdict.code,
    reason:   verdict.reason,
  }
}
