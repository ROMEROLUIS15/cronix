/**
 * langsmith-sink.test.ts — Unit tests for LangSmithSink.
 *
 * Coverage:
 *   - happy path: POST shape (url, headers, body), returns ok with injected id
 *   - PII-safety: only hashes/counters are transmitted, never raw text
 *   - non-2xx → { ok:false, error: LANGSMITH_HTTP_<status> }, never throws
 *   - fetch rejection → { ok:false } with the error message, never throws
 *   - errorCode is surfaced as the run `error` field only when present
 *   - latencyMs anchors start_time relative to the injected clock
 */

import { describe, it, expect, vi } from 'vitest'
import { LangSmithSink } from '@/lib/ai/observability/LangSmithSink'
import type { TraceRecord } from '@/lib/ai/observability/contracts'

const config = {
  apiKey:   'ls-secret',
  endpoint: 'https://api.smith.langchain.com',
  project:  'cronix-test',
}

function baseRecord(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    scope: {
      businessId: 'biz-1',
      channel:    'voice-worker',
      actorKind:  'user',
      actorKey:   'owner-9',
    },
    queryHash:    'qhash01',
    outcome:      'success',
    errorCode:    null,
    finalTextSha: 'fsha02',
    totalTokens:  120,
    latencyMs:    250,
    stepsCount:   2,
    toolsCount:   1,
    llmSteps:     [{ model: '70b', latencyMs: 120, tokens: 80, hadToolCalls: true }],
    toolCalls:    [{ tool: 'schedule', durationMs: 55, status: 'success', argsFingerprint: 'aaaa' }],
    metadata:     { memory_hits: 3 },
    ...overrides,
  }
}

function okResponse(): Response {
  return { ok: true, status: 201 } as Response
}

function makeSink(fetchFn: typeof fetch, id = 'run-uuid-1') {
  return new LangSmithSink(config, {
    fetchFn,
    now:   () => 10_000,
    genId: () => id,
  })
}

describe('LangSmithSink.write', () => {
  it('posts a well-formed run and returns the generated id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse())
    const sink = makeSink(fetchFn)

    const res = await sink.write(baseRecord())

    expect(res).toEqual({ ok: true, value: { id: 'run-uuid-1' } })
    expect(fetchFn).toHaveBeenCalledOnce()

    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.smith.langchain.com/runs')
    expect(init.method).toBe('POST')
    expect(init.headers['x-api-key']).toBe('ls-secret')
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body as string)
    expect(body.id).toBe('run-uuid-1')
    expect(body.trace_id).toBe('run-uuid-1')
    expect(body.dotted_order.endsWith('run-uuid-1')).toBe(true)
    expect(body.run_type).toBe('chain')
    expect(body.name).toBe('agent:voice-worker')
    expect(body.session_name).toBe('cronix-test')
    expect(body.tags).toEqual(['voice-worker', 'success'])
    // end_time = now (10_000); start_time = now - latencyMs (9_750)
    expect(body.end_time).toBe(new Date(10_000).toISOString())
    expect(body.start_time).toBe(new Date(9_750).toISOString())
  })

  it('transmits only hashes and counters — never raw user text', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse())
    const sink = makeSink(fetchFn)

    await sink.write(baseRecord())

    const body = JSON.parse(fetchFn.mock.calls[0]![1].body as string)
    expect(body.inputs).toEqual({ query_sha: 'qhash01' })
    expect(body.outputs.final_text_sha).toBe('fsha02')
    expect(body.outputs.total_tokens).toBe(120)
    // no field named `text`, `query` or `transcription` should ever leave
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/"query"\s*:/)
    expect(serialized).not.toMatch(/transcription/)
  })

  it('omits the error field on success and includes it on failure outcomes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse())
    const sink = makeSink(fetchFn)

    await sink.write(baseRecord())
    const okBody = JSON.parse(fetchFn.mock.calls[0]![1].body as string)
    expect('error' in okBody).toBe(false)

    await sink.write(baseRecord({ outcome: 'error', errorCode: 'TOOL_TIMEOUT' }))
    const failBody = JSON.parse(fetchFn.mock.calls[1]![1].body as string)
    expect(failBody.error).toBe('TOOL_TIMEOUT')
  })

  it('returns a typed error on non-2xx without throwing', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response)
    const sink = makeSink(fetchFn)

    const res = await sink.write(baseRecord())
    expect(res).toEqual({ ok: false, error: 'LANGSMITH_HTTP_429' })
  })

  it('catches fetch rejections and never throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const sink = makeSink(fetchFn)

    await expect(sink.write(baseRecord())).resolves.toEqual({ ok: false, error: 'ECONNRESET' })
  })
})
