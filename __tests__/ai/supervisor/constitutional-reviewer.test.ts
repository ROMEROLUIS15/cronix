/**
 * constitutional-reviewer.test.ts — Unit tests for ConstitutionalReviewer.
 *
 * Coverage:
 *   review — translates allow → { ok: true }
 *   review — translates block + code → discriminated rejection
 *   review — translates warn + code → discriminated rejection with severity warn
 *   review — defaults code to POLICY_VIOLATION when LLM returns null
 *   review — truncates reason to 140 chars
 *   review — empty reason falls back to "sin razón especificada"
 *   review — fail-open on Result.ok=false, reports onError
 *   review — fail-open on timeout, reports onError with elapsed
 *   review — fail-open when LLM promise rejects
 *   review — custom timeoutMs honored
 *   review — default onError sink does not throw when omitted
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConstitutionalReviewer } from '@/lib/ai/supervisor/ConstitutionalReviewer'
import type {
  IReviewerLlm,
  ReviewRequest,
  ReviewerLlmResponse,
  Result,
} from '@/lib/ai/supervisor/contracts'

const REQUEST: ReviewRequest = {
  toolName: 'book_appointment',
  toolArgs: { clientName: 'Juan', date: '2026-06-01', time: '15:00' },
  scope:    { businessId: 'biz_1', channel: 'whatsapp' },
  userUtterance: 'agenda a Juan mañana 3pm',
  recentMemory: [],
}

function makeLlm(result: Result<ReviewerLlmResponse> | Promise<Result<ReviewerLlmResponse>>): IReviewerLlm {
  return {
    review: vi.fn().mockReturnValue(Promise.resolve(result)),
  }
}

describe('ConstitutionalReviewer.review', () => {
  let onError: ReturnType<typeof vi.fn<(stage: string, error: string) => void>>

  beforeEach(() => {
    onError = vi.fn<(stage: string, error: string) => void>()
  })

  it('translates allow into { ok: true }', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: true, value: { verdict: 'allow', code: null, reason: 'target inequívoco' } }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict).toEqual({ ok: true })
    expect(onError).not.toHaveBeenCalled()
  })

  it('translates block into a typed rejection', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: true, value: { verdict: 'block', code: 'AMBIGUOUS_TARGET', reason: 'dos clientes Juan' } }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict).toEqual({
      ok:       false,
      severity: 'block',
      code:     'AMBIGUOUS_TARGET',
      reason:   'dos clientes Juan',
    })
  })

  it('translates warn into a typed rejection with severity warn', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: true, value: { verdict: 'warn', code: 'POLICY_VIOLATION', reason: 'el usuario no confirmó' } }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict).toEqual({
      ok:       false,
      severity: 'warn',
      code:     'POLICY_VIOLATION',
      reason:   'el usuario no confirmó',
    })
  })

  it('defaults code to POLICY_VIOLATION when LLM returns null code on rejection', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: true, value: { verdict: 'block', code: null, reason: 'algo raro' } }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict).toEqual({
      ok:       false,
      severity: 'block',
      code:     'POLICY_VIOLATION',
      reason:   'algo raro',
    })
  })

  it('truncates reason to 140 chars', async () => {
    const longReason = 'a'.repeat(200)
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: true, value: { verdict: 'block', code: 'UNSAFE_ARGS', reason: longReason } }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toHaveLength(140)
  })

  it('falls back to a default reason when LLM returns empty string', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: true, value: { verdict: 'block', code: 'UNSAFE_ARGS', reason: '   ' } }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('sin razón especificada')
  })

  it('fail-opens when the LLM returns Result.ok=false', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: false, error: 'http 503' }),
      onError,
    )
    const verdict = await reviewer.review(REQUEST)
    expect(verdict).toEqual({ ok: true })
    expect(onError).toHaveBeenCalledWith('review.llm', 'http 503')
  })

  it('fail-opens when the LLM exceeds the timeout', async () => {
    const slowLlm: IReviewerLlm = {
      review: () => new Promise(() => { /* never resolves */ }),
    }
    const reviewer = new ConstitutionalReviewer(slowLlm, onError)
    const verdict  = await reviewer.review(REQUEST, { timeoutMs: 20 })
    expect(verdict).toEqual({ ok: true })
    expect(onError).toHaveBeenCalledWith('review.timeout', 'exceeded 20ms')
  })

  it('fail-opens when the LLM promise rejects', async () => {
    const throwingLlm: IReviewerLlm = {
      review: () => Promise.reject(new Error('boom')),
    }
    const reviewer = new ConstitutionalReviewer(throwingLlm, onError)
    const verdict  = await reviewer.review(REQUEST, { timeoutMs: 50 })
    expect(verdict).toEqual({ ok: true })
  })

  it('default onError sink does not throw when omitted', async () => {
    const reviewer = new ConstitutionalReviewer(
      makeLlm({ ok: false, error: 'X' }),
    )
    await expect(reviewer.review(REQUEST)).resolves.toEqual({ ok: true })
  })
})
