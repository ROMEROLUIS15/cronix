/**
 * composite-sink.test.ts — Unit tests for CompositeSink.
 *
 * Coverage:
 *   - the primary Result is authoritative and returned to the caller
 *   - every sink receives the exact same record
 *   - a secondary !ok Result invokes onSecondaryError but does not fail write
 *   - a secondary that THROWS is caught (safeWrite) and reported, not propagated
 *   - a primary failure propagates as the returned Result
 */

import { describe, it, expect, vi } from 'vitest'
import { CompositeSink } from '@/lib/ai/observability/CompositeSink'
import type { ITraceSink, TraceRecord, Result } from '@/lib/ai/observability/contracts'

const record: TraceRecord = {
  scope: { businessId: 'biz-1', channel: 'voice-worker', actorKind: 'user', actorKey: 'owner-9' },
  queryHash:    'q',
  outcome:      'success',
  errorCode:    null,
  finalTextSha: null,
  totalTokens:  0,
  latencyMs:    10,
  stepsCount:   0,
  toolsCount:   0,
  llmSteps:     [],
  toolCalls:    [],
  metadata:     {},
}

function sinkWith(result: Result<{ id: string }>): { sink: ITraceSink; write: ReturnType<typeof vi.fn> } {
  const write = vi.fn().mockResolvedValue(result)
  return { sink: { write }, write }
}

describe('CompositeSink.write', () => {
  it('returns the primary result and fans the same record to every sink', async () => {
    const primary   = sinkWith({ ok: true, value: { id: 'pg-1' } })
    const secondary = sinkWith({ ok: true, value: { id: 'ls-1' } })
    const onSecondaryError = vi.fn()

    const composite = new CompositeSink(primary.sink, [secondary.sink], onSecondaryError)
    const res = await composite.write(record)

    expect(res).toEqual({ ok: true, value: { id: 'pg-1' } })
    expect(primary.write).toHaveBeenCalledWith(record)
    expect(secondary.write).toHaveBeenCalledWith(record)
    expect(onSecondaryError).not.toHaveBeenCalled()
  })

  it('reports a secondary failure without failing the primary write', async () => {
    const primary   = sinkWith({ ok: true, value: { id: 'pg-1' } })
    const secondary = sinkWith({ ok: false, error: 'LANGSMITH_HTTP_429' })
    const onSecondaryError = vi.fn()

    const composite = new CompositeSink(primary.sink, [secondary.sink], onSecondaryError)
    const res = await composite.write(record)

    expect(res).toEqual({ ok: true, value: { id: 'pg-1' } })
    expect(onSecondaryError).toHaveBeenCalledWith('LANGSMITH_HTTP_429')
  })

  it('catches a secondary that throws and reports it, never propagating', async () => {
    const primary = sinkWith({ ok: true, value: { id: 'pg-1' } })
    const throwing: ITraceSink = { write: vi.fn().mockRejectedValue(new Error('boom')) }
    const onSecondaryError = vi.fn()

    const composite = new CompositeSink(primary.sink, [throwing], onSecondaryError)
    const res = await composite.write(record)

    expect(res).toEqual({ ok: true, value: { id: 'pg-1' } })
    expect(onSecondaryError).toHaveBeenCalledWith('boom')
  })

  it('propagates a primary failure as the returned result', async () => {
    const primary   = sinkWith({ ok: false, error: 'DB_DOWN' })
    const secondary = sinkWith({ ok: true, value: { id: 'ls-1' } })
    const onSecondaryError = vi.fn()

    const composite = new CompositeSink(primary.sink, [secondary.sink], onSecondaryError)
    const res = await composite.write(record)

    expect(res).toEqual({ ok: false, error: 'DB_DOWN' })
    expect(onSecondaryError).not.toHaveBeenCalled()
  })

  it('defaults onSecondaryError to a no-op when omitted', async () => {
    const primary   = sinkWith({ ok: true, value: { id: 'pg-1' } })
    const secondary = sinkWith({ ok: false, error: 'X' })

    const composite = new CompositeSink(primary.sink, [secondary.sink])
    await expect(composite.write(record)).resolves.toEqual({ ok: true, value: { id: 'pg-1' } })
  })
})
