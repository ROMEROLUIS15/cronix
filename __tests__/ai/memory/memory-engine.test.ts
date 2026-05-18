/**
 * memory-engine.test.ts — Unit tests for MemoryEngine.
 *
 * Coverage:
 *   recall — happy path, embedder failure, store failure
 *   write  — happy path, embedder failure, store failure (never throws)
 *   error sink is invoked with stage + message on every failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryEngine } from '@/lib/ai/memory/MemoryEngine'
import type {
  IEmbedder,
  IEpisodicStore,
  MemoryScope,
  MemoryRecord,
  Result,
} from '@/lib/ai/memory/contracts'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const scope: MemoryScope = {
  businessId: 'biz-1',
  actorKind:  'client_phone',
  actorKey:   '+573001234567',
}

const sampleVector = new Array(384).fill(0.01) as ReadonlyArray<number>

const record: MemoryRecord = {
  id:         'mem-1',
  content:    'Cliente prefiere los lunes',
  kind:       'preference',
  similarity: 0.92,
  metadata:   {},
  createdAt:  '2026-05-01T12:00:00Z',
}

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeEmbedder(result: Result<ReadonlyArray<number>>): IEmbedder {
  return {
    dimensions: 384,
    embed: vi.fn().mockResolvedValue(result),
  }
}

function makeStore(
  searchResult: Result<ReadonlyArray<MemoryRecord>>,
  insertResult: Result<{ id: string }>,
): IEpisodicStore {
  return {
    search: vi.fn().mockResolvedValue(searchResult),
    insert: vi.fn().mockResolvedValue(insertResult),
  }
}

// ── recall ────────────────────────────────────────────────────────────────────

describe('MemoryEngine.recall', () => {
  let onError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onError = vi.fn()
  })

  it('returns records on happy path', async () => {
    const embedder = makeEmbedder({ ok: true, value: sampleVector })
    const store    = makeStore({ ok: true, value: [record] }, { ok: true, value: { id: 'x' } })
    const engine   = new MemoryEngine(embedder, store, onError)

    const result = await engine.recall(scope, 'preferencias del cliente')

    expect(result).toEqual([record])
    expect(embedder.embed).toHaveBeenCalledWith('preferencias del cliente')
    expect(store.search).toHaveBeenCalledWith(scope, sampleVector, undefined)
    expect(onError).not.toHaveBeenCalled()
  })

  it('forwards RecallOptions to the store', async () => {
    const embedder = makeEmbedder({ ok: true, value: sampleVector })
    const store    = makeStore({ ok: true, value: [] }, { ok: true, value: { id: 'x' } })
    const engine   = new MemoryEngine(embedder, store, onError)

    await engine.recall(scope, 'q', { topK: 3, threshold: 0.85 })

    expect(store.search).toHaveBeenCalledWith(scope, sampleVector, { topK: 3, threshold: 0.85 })
  })

  it('degrades to [] and reports when embedder fails', async () => {
    const embedder = makeEmbedder({ ok: false, error: 'EMBED_HTTP_500' })
    const store    = makeStore({ ok: true, value: [record] }, { ok: true, value: { id: 'x' } })
    const engine   = new MemoryEngine(embedder, store, onError)

    const result = await engine.recall(scope, 'q')

    expect(result).toEqual([])
    expect(store.search).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('recall.embed', 'EMBED_HTTP_500')
  })

  it('degrades to [] and reports when store search fails', async () => {
    const embedder = makeEmbedder({ ok: true, value: sampleVector })
    const store    = makeStore({ ok: false, error: 'DB_DOWN' }, { ok: true, value: { id: 'x' } })
    const engine   = new MemoryEngine(embedder, store, onError)

    const result = await engine.recall(scope, 'q')

    expect(result).toEqual([])
    expect(onError).toHaveBeenCalledWith('recall.search', 'DB_DOWN')
  })
})

// ── write ─────────────────────────────────────────────────────────────────────

describe('MemoryEngine.write', () => {
  let onError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onError = vi.fn()
  })

  it('embeds the content and inserts on happy path', async () => {
    const embedder = makeEmbedder({ ok: true, value: sampleVector })
    const store    = makeStore({ ok: true, value: [] }, { ok: true, value: { id: 'mem-new' } })
    const engine   = new MemoryEngine(embedder, store, onError)

    await engine.write(scope, {
      kind:    'episodic',
      content: 'Cliente reservó manicura',
      ttlDays: 180,
    })

    expect(embedder.embed).toHaveBeenCalledWith('Cliente reservó manicura')
    expect(store.insert).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ kind: 'episodic', content: 'Cliente reservó manicura', ttlDays: 180 }),
      sampleVector,
    )
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not throw and reports when embedder fails', async () => {
    const embedder = makeEmbedder({ ok: false, error: 'EMBED_NETWORK: timeout' })
    const store    = makeStore({ ok: true, value: [] }, { ok: true, value: { id: 'x' } })
    const engine   = new MemoryEngine(embedder, store, onError)

    await expect(
      engine.write(scope, { kind: 'fact', content: 'x' }),
    ).resolves.toBeUndefined()

    expect(store.insert).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('write.embed', 'EMBED_NETWORK: timeout')
  })

  it('does not throw and reports when store insert fails', async () => {
    const embedder = makeEmbedder({ ok: true, value: sampleVector })
    const store    = makeStore({ ok: true, value: [] }, { ok: false, error: 'INSERT_FAILED' })
    const engine   = new MemoryEngine(embedder, store, onError)

    await expect(
      engine.write(scope, { kind: 'fact', content: 'x' }),
    ).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledWith('write.insert', 'INSERT_FAILED')
  })

  it('default onError sink does not throw when omitted', async () => {
    const embedder = makeEmbedder({ ok: false, error: 'X' })
    const store    = makeStore({ ok: true, value: [] }, { ok: true, value: { id: 'x' } })
    const engine   = new MemoryEngine(embedder, store) // no sink

    await expect(engine.write(scope, { kind: 'fact', content: 'x' })).resolves.toBeUndefined()
    await expect(engine.recall(scope, 'x')).resolves.toEqual([])
  })
})
