/**
 * AI Planner — Unit Tests
 *
 * Tests for lib/application/ai/planner.ts
 * Covers: LLM response parsing, error handling, message mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runReActLoop } from '@/lib/application/ai/planner'
import type { ToolSchema } from '@/lib/ai/providers/types'

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeLlm(responses: Array<{ content?: string | null; tool_calls?: any[]; error?: string }>) {
  let idx = 0
  return {
    chat: vi.fn().mockImplementation(() => {
      const r = responses[idx] ?? responses[responses.length - 1]!
      idx++
      const message: any = { role: 'assistant', content: r.content ?? null, tool_calls: r.tool_calls }
      return Promise.resolve({ message, error: r.error })
    }),
  }
}

const TOOLS: ToolSchema[] = [{
  type: 'function' as const,
  function: {
    name: 'check_availability',
    description: 'Check slots',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}]

const MSGS = [{ role: 'user' as const, content: 'test' }]

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AI Planner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns text when LLM responds without tool calls', async () => {
    const llm = makeLlm([{ content: 'I can help with that!' }])

    const result = await runReActLoop(llm as any, MSGS as any, TOOLS, 'user-1')

    expect(result.type).toBe('text')
    expect((result as any).text).toBe('I can help with that!')
    expect(result.steps).toBe(1)
  })

  it('returns commands when LLM requests tool calls', async () => {
    const llm = makeLlm([{
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'check_availability', arguments: '{}' } }],
    }])

    const result = await runReActLoop(llm as any, MSGS as any, TOOLS, 'user-1')

    expect(result.type).toBe('commands')
    expect((result as any).commands).toHaveLength(1)
    expect((result as any).commands[0].toolName).toBe('check_availability')
  })

  it('parses tool call arguments from JSON string', async () => {
    const llm = makeLlm([{
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'check_availability', arguments: '{"date":"2026-04-10"}' } }],
    }])

    const result = await runReActLoop(llm as any, MSGS as any, TOOLS, 'user-1')

    expect((result as any).commands[0].args).toEqual({ date: '2026-04-10' })
  })

  it('handles invalid JSON arguments gracefully', async () => {
    const llm = makeLlm([{
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'check_availability', arguments: 'not-json' } }],
    }])

    const result = await runReActLoop(llm as any, MSGS as any, TOOLS, 'user-1')

    expect((result as any).commands[0].args).toEqual({})
  })

  it('returns error response when LLM returns an error', async () => {
    const llm = makeLlm([{ error: 'rate_limit exceeded' }])

    const result = await runReActLoop(llm as any, MSGS as any, TOOLS, 'user-1')

    expect(result.type).toBe('error')
    expect((result as any).text).toMatch(/demanda/i)
    expect((result as any).loopExhausted).toBe(false)
  })

  it('returns generic error message for non-rate-limit errors', async () => {
    const llm = makeLlm([{ error: 'connection refused' }])

    const result = await runReActLoop(llm as any, MSGS as any, TOOLS, 'user-1')

    expect((result as any).text).toMatch(/problema técnico/i)
  })

  it('returns commands on each tool_call (planner exits early)', async () => {
    // The planner returns commands as soon as the LLM requests a tool call.
    // It only reaches MAX_STEPS exhaustion if called repeatedly by the outer loop.
    const llm = makeLlm([{
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'check_availability', arguments: '{}' } }],
    }])

    const result = await runReActLoop(llm as any, [...MSGS] as any, TOOLS, 'user-1')

    expect(result.type).toBe('commands')
    expect(result.steps).toBe(1)
  })

  it('appends assistant message to messages array', async () => {
    const msgs = [{ role: 'user' as const, content: 'test' }]
    const llm = makeLlm([{
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'check_availability', arguments: '{}' } }],
    }])

    await runReActLoop(llm as any, msgs as any, TOOLS, 'user-1')

    expect(msgs).toHaveLength(2)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(msgs[1]!.role).toBe('assistant')
  })
})
