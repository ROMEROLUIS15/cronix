import type {
  IReviewer,
  IReviewerLlm,
  ReviewRequest,
  ReviewOptions,
  ReviewVerdict,
  ReviewerLlmResponse,
  ReviewRejectionCode,
  ReviewSeverity,
} from './contracts'

/**
 * Constitutional reviewer. Single responsibility: take a write-tool request,
 * delegate semantic judgement to an IReviewerLlm, and translate the response
 * into a domain ReviewVerdict.
 *
 * Invariants:
 *   • Never throws — degrades to { ok: true } (fail-open) on any failure.
 *     Reason: a flaky reviewer must not block legitimate bookings. Failures
 *     are surfaced via onError for ai_traces.
 *   • Pure orchestration. The LLM call, prompt, and parsing live in the
 *     IReviewerLlm adapter — this class is runtime-agnostic and testable
 *     with a fake LLM.
 *   • Timeout is enforced here, not in the adapter, so every adapter inherits
 *     the same SLA without duplicating logic.
 */
export class ConstitutionalReviewer implements IReviewer {
  private static readonly DEFAULT_TIMEOUT_MS = 1500

  constructor(
    private readonly llm:     IReviewerLlm,
    private readonly onError: (stage: string, error: string) => void = () => {},
  ) {}

  async review(request: ReviewRequest, opts?: ReviewOptions): Promise<ReviewVerdict> {
    const timeoutMs = opts?.timeoutMs ?? ConstitutionalReviewer.DEFAULT_TIMEOUT_MS

    const raced = await raceWithTimeout(this.llm.review(request), timeoutMs)
    if (raced.kind === 'timeout') {
      this.onError('review.timeout', `exceeded ${timeoutMs}ms`)
      return { ok: true }
    }

    const result = raced.value
    if (!result.ok) {
      this.onError('review.llm', result.error)
      return { ok: true }
    }

    return mapResponseToVerdict(result.value)
  }
}

function mapResponseToVerdict(res: ReviewerLlmResponse): ReviewVerdict {
  if (res.verdict === 'allow') return { ok: true }

  const severity: ReviewSeverity = res.verdict === 'block' ? 'block' : 'warn'
  const code: ReviewRejectionCode = res.code ?? 'POLICY_VIOLATION'
  const reason = res.reason.trim().slice(0, 140) || 'sin razón especificada'

  return { ok: false, severity, code, reason }
}

type RaceResult<T> =
  | { readonly kind: 'value';   readonly value: T }
  | { readonly kind: 'timeout' }

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<RaceResult<T>> {
  return new Promise<RaceResult<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
    promise
      .then((value) => { clearTimeout(timer); resolve({ kind: 'value', value }) })
      .catch(()      => { clearTimeout(timer); resolve({ kind: 'timeout' }) })
  })
}
