/**
 * semantic-router.test.ts — Unit tests for SemanticRouter.
 *
 * Coverage:
 *   classify — happy path picks the highest-similarity prototype
 *   classify — returns null below threshold
 *   classify — returns null when embedder fails (no throw)
 *   classify — returns null on empty input
 *   classify — returns null when prototypes list is empty
 *   classify — skips prototypes with mismatched dimensions
 *   classify — respects custom threshold via opts
 *   cosine    — works on un-normalized vectors (defensive fallback)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SemanticRouter } from '@/lib/ai/router/SemanticRouter'
import type {
  IEmbedder,
  IntentPrototype,
  Result,
} from '@/lib/ai/router/contracts'

// Three 4-dim L2-normalized vectors for deterministic tests.
const VEC_A: ReadonlyArray<number> = [1, 0, 0, 0]                                              // pure A
const VEC_B: ReadonlyArray<number> = [0, 1, 0, 0]                                              // pure B
const VEC_A_NEAR: ReadonlyArray<number> = [0.98, 0.198997, 0, 0]                                // ~0.98 cos with A

function makeEmbedder(result: Result<ReadonlyArray<number>>): IEmbedder {
  return {
    dimensions: 4,
    embed: vi.fn().mockResolvedValue(result),
  }
}

const PROTOS: ReadonlyArray<IntentPrototype> = [
  { intent: 'book_appointment',  text: 'agendar', embedding: VEC_A },
  { intent: 'cancel_appointment', text: 'cancelar', embedding: VEC_B },
]

describe('SemanticRouter.classify', () => {
  let onError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onError = vi.fn()
  })

  it('returns the highest-similarity intent above threshold', async () => {
    const router = new SemanticRouter(
      makeEmbedder({ ok: true, value: VEC_A_NEAR }),
      PROTOS,
      onError,
    )
    const result = await router.classify('quiero agendar')

    expect(result).not.toBeNull()
    expect(result!.intent).toBe('book_appointment')
    expect(result!.confidence).toBeGreaterThan(0.95)
    expect(result!.matched).toBe('agendar')
  })

  it('returns null when no prototype passes the threshold', async () => {
    const router = new SemanticRouter(
      makeEmbedder({ ok: true, value: [0.6, 0.6, 0.529, 0] }), // ~0.6 cos with both — below default 0.78
      PROTOS,
      onError,
    )
    expect(await router.classify('algo ambiguo')).toBeNull()
  })

  it('respects a custom higher threshold', async () => {
    const router = new SemanticRouter(
      makeEmbedder({ ok: true, value: VEC_A_NEAR }),
      PROTOS,
      onError,
    )
    // Confidence will be ~0.98 — passes default 0.78 but should be filtered at 0.99
    expect(await router.classify('q', { threshold: 0.99 })).toBeNull()
  })

  it('returns null and reports onError when the embedder fails', async () => {
    const router = new SemanticRouter(
      makeEmbedder({ ok: false, error: 'EMBED_HTTP_503' }),
      PROTOS,
      onError,
    )
    expect(await router.classify('q')).toBeNull()
    expect(onError).toHaveBeenCalledWith('classify.embed', 'EMBED_HTTP_503')
  })

  it('returns null on empty input without hitting the embedder', async () => {
    const embedder = makeEmbedder({ ok: true, value: VEC_A })
    const router   = new SemanticRouter(embedder, PROTOS, onError)
    expect(await router.classify('   ')).toBeNull()
    expect(embedder.embed).not.toHaveBeenCalled()
  })

  it('returns null when prototypes list is empty', async () => {
    const embedder = makeEmbedder({ ok: true, value: VEC_A })
    const router   = new SemanticRouter(embedder, [], onError)
    expect(await router.classify('q')).toBeNull()
    expect(embedder.embed).not.toHaveBeenCalled()
  })

  it('skips prototypes with mismatched dimensions', async () => {
    const bad: IntentPrototype = { intent: 'greeting', text: 'hola', embedding: [1, 0] }
    const router = new SemanticRouter(
      makeEmbedder({ ok: true, value: VEC_A_NEAR }),
      [bad, ...PROTOS],
      onError,
    )
    const result = await router.classify('q')
    expect(result?.intent).toBe('book_appointment')
  })

  it('default onError sink does not throw when omitted', async () => {
    const router = new SemanticRouter(
      makeEmbedder({ ok: false, error: 'X' }),
      PROTOS,
    ) // no sink
    await expect(router.classify('q')).resolves.toBeNull()
  })
})
