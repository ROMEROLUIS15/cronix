/**
 * Supervisor layer contracts. Pure types — runtime-agnostic.
 *
 * Duplicated byte-for-byte under `supabase/functions/_shared/supervisor/contracts.ts`
 * (Deno cannot import from Node paths). A parity test detects drift.
 */

export type ReviewedToolName =
  | 'book_appointment'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'delete_client'

export type ReviewSeverity = 'block' | 'warn'

export type ReviewRejectionCode =
  | 'TENANT_MISMATCH'
  | 'DUPLICATE_INTENT'
  | 'CONTRADICTS_MEMORY'
  | 'POLICY_VIOLATION'
  | 'AMBIGUOUS_TARGET'
  | 'UNSAFE_ARGS'

export interface TenantScope {
  readonly businessId: string
  readonly channel:    'whatsapp' | 'voice' | 'dashboard'
}

export interface ReviewMemorySnippet {
  readonly content:    string
  readonly similarity: number
  readonly createdAt:  string
}

export interface ReviewConversationTurn {
  readonly role:    'user' | 'assistant'
  readonly content: string
}

export interface ReviewRequest {
  readonly toolName:     ReviewedToolName
  readonly toolArgs:     Readonly<Record<string, unknown>>
  readonly scope:        TenantScope
  readonly userUtterance: string
  readonly recentMemory: ReadonlyArray<ReviewMemorySnippet>
  /**
   * Last in-frame conversation turns (oldest→newest). Lets the reviewer
   * resolve short confirmations ("sí", "dale") against the action the
   * assistant proposed, instead of judging the bare utterance alone.
   */
  readonly conversationWindow?: ReadonlyArray<ReviewConversationTurn>
}

export type ReviewVerdict =
  | { readonly ok: true }
  | {
      readonly ok:       false
      readonly severity: ReviewSeverity
      readonly code:     ReviewRejectionCode
      readonly reason:   string
    }

export interface ReviewerLlmResponse {
  readonly verdict: 'allow' | 'block' | 'warn'
  readonly code:    ReviewRejectionCode | null
  readonly reason:  string
}

export type Result<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: string }

export interface IReviewerLlm {
  review(request: ReviewRequest): Promise<Result<ReviewerLlmResponse>>
}

export interface ReviewOptions {
  readonly timeoutMs?: number
}

export interface IReviewer {
  review(request: ReviewRequest, opts?: ReviewOptions): Promise<ReviewVerdict>
}
