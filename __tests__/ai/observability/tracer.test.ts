/**
 * tracer.test.ts — Unit tests for Tracer / TraceHandle.
 *
 * Coverage:
 *   - finish() builds a complete TraceRecord from the accumulated steps
 *   - latencyMs is computed from the injected clock
 *   - totalTokens is summed from llm steps
 *   - double-finish() is idempotent
 *   - sink failure routes to onError, never throws
 *   - records added AFTER finish() are dropped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Tracer } from '@/lib/ai/observability/Tracer'
import type {
  ITraceSink,
  TraceScope,
  TraceRecord,
  Result,
} from '@/lib/ai/observability/contracts'

const scope: TraceScope = {
  businessId: 'biz-1',
  channel:    'whatsapp',
  actorKind:  'client_phone',
  actorKey:   '+573001234567',
}

function makeSink(result: Result<{ id: string }>) {
  const write = vi.fn().mockResolvedValue(result)
  const sink: ITraceSink = { write }
  return { sink, write }
}

function makeClock(values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]!
}

describe('Tracer.start + TraceHandle.finish', () => {
  let onError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onError = vi.fn()
  })

  it('writes a fully populated record on the happy path', async () => {
    const { sink, write } = makeSink({ ok: true, value: { id: 'trace-1' } })
    const clock  = makeClock([1000, 1250]) // start, finish → 250ms
    const tracer = new Tracer(sink, clock, onError)

    const handle = tracer.start(scope, 'queryhash01', { memory_hits: 3 })
    handle.recordLlmStep({ model: '8b', latencyMs: 120, tokens: 80,  hadToolCalls: true  })
    handle.recordLlmStep({ model: '8b', latencyMs:  90, tokens: 40,  hadToolCalls: false })
    handle.recordToolCall({
      tool:            'confirm_booking',
      durationMs:      55,
      status:          'success',
      argsFingerprint: 'aaaa1111',
    })

    await handle.finish({ outcome: 'success', finalTextSha: 'bbbb2222' })

    expect(write).toHaveBeenCalledOnce()
    const record = write.mock.calls[0]![0] as TraceRecord
    expect(record.scope).toEqual(scope)
    expect(record.queryHash).toBe('queryhash01')
    expect(record.outcome).toBe('success')
    expect(record.errorCode).toBeNull()
    expect(record.finalTextSha).toBe('bbbb2222')
    expect(record.totalTokens).toBe(120)
    expect(record.latencyMs).toBe(250)
    expect(record.stepsCount).toBe(2)
    expect(record.toolsCount).toBe(1)
    expect(record.llmSteps).toHaveLength(2)
    expect(record.toolCalls[0]?.tool).toBe('confirm_booking')
    expect(record.metadata).toEqual({ memory_hits: 3 })
    expect(onError).not.toHaveBeenCalled()
  })

  it('serializes errorCode null and computes zero counts for empty turns', async () => {
    const { sink, write } = makeSink({ ok: true, value: { id: 'trace-2' } })
    const tracer = new Tracer(sink, makeClock([0, 10]), onError)

    const handle = tracer.start(scope, 'q')
    await handle.finish({ outcome: 'no_action' })

    const record = write.mock.calls[0]![0] as TraceRecord
    expect(record.totalTokens).toBe(0)
    expect(record.stepsCount).toBe(0)
    expect(record.toolsCount).toBe(0)
    expect(record.outcome).toBe('no_action')
    expect(record.errorCode).toBeNull()
    expect(record.finalTextSha).toBeNull()
  })

  it('ignores additional records after finish()', async () => {
    const { sink, write } = makeSink({ ok: true, value: { id: 'trace-3' } })
    const tracer = new Tracer(sink, makeClock([0, 10, 20]), onError)

    const handle = tracer.start(scope, 'q')
    handle.recordLlmStep({ model: '8b', latencyMs: 10, tokens: 5, hadToolCalls: false })
    await handle.finish({ outcome: 'success' })

    handle.recordLlmStep({ model: '70b', latencyMs: 999, tokens: 999, hadToolCalls: false })
    handle.recordToolCall({ tool: 'late', durationMs: 1, status: 'success', argsFingerprint: 'x' })

    const record = write.mock.calls[0]![0] as TraceRecord
    expect(record.stepsCount).toBe(1)
    expect(record.toolsCount).toBe(0)
    expect(record.totalTokens).toBe(5)
  })

  it('finish() is idempotent — second call does not write again', async () => {
    const { sink, write } = makeSink({ ok: true, value: { id: 'trace-4' } })
    const tracer = new Tracer(sink, makeClock([0, 10, 20]), onError)

    const handle = tracer.start(scope, 'q')
    await handle.finish({ outcome: 'success' })
    await handle.finish({ outcome: 'error' })

    expect(write).toHaveBeenCalledOnce()
  })

  it('routes sink failures to onError and never throws', async () => {
    const { sink } = makeSink({ ok: false, error: 'DB_DOWN' })
    const tracer   = new Tracer(sink, makeClock([0, 10]), onError)

    const handle = tracer.start(scope, 'q')
    await expect(handle.finish({ outcome: 'failure' })).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledWith('finish.write', 'DB_DOWN')
  })

  it('default onError sink does not throw when omitted', async () => {
    const { sink } = makeSink({ ok: false, error: 'X' })
    const tracer   = new Tracer(sink, makeClock([0, 10])) // no onError

    const handle = tracer.start(scope, 'q')
    await expect(handle.finish({ outcome: 'error' })).resolves.toBeUndefined()
  })
})
