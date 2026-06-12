/**
 * Regression: Llama 3.3 emits `arguments: "null"` for no-param tools like
 * get_services. JSON.parse("null") → null passed the JSON try/catch, then
 * buildToolFingerprint(null) called Object.keys(null) → uncaught TypeError →
 * the whole turn threw (HTTP 500 / LLM_EXCEPTION) with tool_calls empty.
 *
 * coerceToolArgs guarantees stepLlmLoop always hands the tool a plain object.
 * (Tested as a pure unit — importing the pipeline itself pulls in the Deno-only
 * Sentry sink, which vitest can't transform.)
 */

import { describe, it, expect } from 'vitest'
import { coerceToolArgs } from '../core/tool-args.ts'

describe('coerceToolArgs — malformed tool-call args never crash the turn', () => {
  it('null → {} (the get_services HTTP 500 trigger)', () => {
    expect(coerceToolArgs(null)).toEqual({})
  })

  it('array → {}', () => {
    expect(coerceToolArgs([])).toEqual({})
    expect(coerceToolArgs([1, 2])).toEqual({})
  })

  it('primitives → {}', () => {
    expect(coerceToolArgs(undefined)).toEqual({})
    expect(coerceToolArgs(42)).toEqual({})
    expect(coerceToolArgs('x')).toEqual({})
  })

  it('plain object → passed through unchanged', () => {
    expect(coerceToolArgs({ date: '2026-06-15', n: 3 })).toEqual({ date: '2026-06-15', n: 3 })
    expect(coerceToolArgs({})).toEqual({})
  })

  it('result is always safe for Object.keys (the crash site)', () => {
    for (const raw of [null, undefined, [], 1, 'x', { a: 1 }]) {
      expect(() => Object.keys(coerceToolArgs(raw))).not.toThrow()
    }
  })
})
