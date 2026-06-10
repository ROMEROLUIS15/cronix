/**
 * guard.test.ts — Unit tests for reviewWriteOrFailOpen.
 *
 * Coverage:
 *   approves when reviewer returns ok=true
 *   denies on block verdict, surfacing code + reason + severity
 *   approves on warn (warns are logged elsewhere, not enforced)
 *   throws when recentMemory is not an array (programmer error)
 *   forwards timeoutMs to the reviewer
 *   builds a ReviewRequest with the exact payload shape expected by the rubric
 */

import { describe, it, expect, vi } from 'vitest'
import { reviewWriteOrFailOpen } from '@/lib/ai/supervisor/guard'
import type {
  IReviewer,
  ReviewMemorySnippet,
  ReviewVerdict,
} from '@/lib/ai/supervisor/contracts'

function makeReviewer(verdict: ReviewVerdict): { reviewer: IReviewer; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue(verdict)
  return { reviewer: { review: spy }, spy }
}

const MEMORY: ReadonlyArray<ReviewMemorySnippet> = [
  { content: 'Juan Pérez agendó corte', similarity: 0.81, createdAt: '2026-05-10T15:00:00Z' },
]

const BASE = {
  toolName: 'book_appointment' as const,
  args:     { clientName: 'Juan', date: '2026-06-01', time: '15:00' },
  scope:    { businessId: 'biz_1', channel: 'whatsapp' as const },
  userUtterance: 'agenda a Juan mañana a las 3pm',
  recentMemory:  MEMORY,
}

describe('reviewWriteOrFailOpen', () => {
  it('approves when the reviewer returns ok=true', async () => {
    const { reviewer } = makeReviewer({ ok: true })
    const outcome = await reviewWriteOrFailOpen({ ...BASE, reviewer })
    expect(outcome).toEqual({ allowed: true })
  })

  it('denies on block, propagating code + reason + severity', async () => {
    const { reviewer } = makeReviewer({
      ok:       false,
      severity: 'block',
      code:     'AMBIGUOUS_TARGET',
      reason:   'dos clientes Juan en memoria',
    })
    const outcome = await reviewWriteOrFailOpen({ ...BASE, reviewer })
    expect(outcome).toEqual({
      allowed:  false,
      severity: 'block',
      code:     'AMBIGUOUS_TARGET',
      reason:   'dos clientes Juan en memoria',
    })
  })

  it('approves warn verdicts (warns log elsewhere, do not block writes)', async () => {
    const { reviewer } = makeReviewer({
      ok:       false,
      severity: 'warn',
      code:     'POLICY_VIOLATION',
      reason:   'usuario no confirmó',
    })
    const outcome = await reviewWriteOrFailOpen({ ...BASE, reviewer })
    expect(outcome).toEqual({ allowed: true })
  })

  it('throws TypeError when recentMemory is not an array', async () => {
    const { reviewer } = makeReviewer({ ok: true })
    await expect(
      reviewWriteOrFailOpen({
        ...BASE,
        reviewer,
        recentMemory: undefined as unknown as ReadonlyArray<ReviewMemorySnippet>,
      }),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('forwards timeoutMs to the reviewer', async () => {
    const { reviewer, spy } = makeReviewer({ ok: true })
    await reviewWriteOrFailOpen({ ...BASE, reviewer, timeoutMs: 250 })
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { timeoutMs: 250 })
  })

  it('builds a ReviewRequest with exactly the rubric-required shape', async () => {
    const { reviewer, spy } = makeReviewer({ ok: true })
    await reviewWriteOrFailOpen({ ...BASE, reviewer })

    const [request] = spy.mock.calls[0]!
    expect(request).toEqual({
      toolName:      'book_appointment',
      toolArgs:      BASE.args,
      scope:         BASE.scope,
      userUtterance: BASE.userUtterance,
      recentMemory:  MEMORY,
    })
  })
})
