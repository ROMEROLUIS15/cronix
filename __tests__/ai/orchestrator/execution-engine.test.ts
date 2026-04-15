/**
 * execution-engine.test.ts
 *
 * Tests for ExecutionEngine.execute():
 *   - reject path
 *   - execute_immediately (authorized + unauthorized)
 *   - reason_with_llm: text response, tool call, multi-step tool chain
 *   - Token accumulation
 *   - llmMessages propagation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExecutionEngine, type IToolExecutor, type IMockLlmProvider, type MockLlmResponse } from '@/lib/ai/orchestrator/execution-engine'
import type { Decision, ConversationState, AiInput } from '@/lib/ai/orchestrator/types'
import type { LlmMessage } from '@/lib/ai/providers/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  const now = new Date().toISOString()
  return {
    sessionId:     'sess-1',
    userId:        'user-1',
    businessId:    'biz-1',
    channel:       'web',
    flow:          'idle',
    draft:         null,
    missingFields: [],
    lastIntent:    null,
    lastToolCalls: null,
    turnCount:     0,
    maxTurns:      6,
    createdAt:     now,
    updatedAt:     now,
    ...overrides,
  }
}

function makeInput(overrides: Partial<AiInput> = {}): AiInput {
  return {
    text:       'hola',
    userId:     'user-1',
    businessId: 'biz-1',
    userRole:   'owner',
    timezone:   'America/Bogota',
    channel:    'web',
    history:    [],
    context: {
      businessId:   'biz-1',
      businessName: 'Barbería Test',
      timezone:     'America/Bogota',
    },
    ...overrides,
  }
}

function rejectDecision(reason = 'Límite de turnos.'): Extract<Decision, { type: 'reject' }> {
  return { type: 'reject', reason }
}

function immediateDecision(intent = 'confirm_booking', args = {}): Extract<Decision, { type: 'execute_immediately' }> {
  return { type: 'execute_immediately', intent, args }
}

function llmDecision(messages: LlmMessage[] = [{ role: 'system', content: 'test' }]): Extract<Decision, { type: 'reason_with_llm' }> {
  return {
    type:     'reason_with_llm',
    messages,
    toolDefs: [],
  }
}

// ── Mock implementations ──────────────────────────────────────────────────────

class MockTool implements IToolExecutor {
  constructor(
    private response: { success: boolean; result: string } = { success: true, result: 'Listo.' }
  ) {}

  async execute(): Promise<{ success: boolean; result: string }> {
    return this.response
  }
}

class SequenceLlm implements IMockLlmProvider {
  private queue: MockLlmResponse[]
  constructor(responses: MockLlmResponse[]) {
    this.queue = [...responses]
  }
  async chat(): Promise<MockLlmResponse> {
    return this.queue.shift() ?? { content: 'fallback' }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExecutionEngine', () => {

  // ── reject path ────────────────────────────────────────────────────────────

  describe('reject decision', () => {
    it('returns the rejection reason text', async () => {
      const engine = new ExecutionEngine()
      const result = await engine.execute(rejectDecision('Por favor, empieza de nuevo.'), makeState(), makeInput())

      expect(result.text).toBe('Por favor, empieza de nuevo.')
      expect(result.actionPerformed).toBe(false)
      expect(result.toolTrace).toHaveLength(0)
    })

    it('resets flow to idle when rejecting during awaiting_confirmation', async () => {
      const engine = new ExecutionEngine()
      const state = makeState({ flow: 'awaiting_confirmation' })
      const result = await engine.execute(rejectDecision(), state, makeInput())

      expect(result.nextState.flow).toBe('idle')
      expect(result.nextState.draft).toBeNull()
    })

    it('keeps flow unchanged when rejecting in idle', async () => {
      const engine = new ExecutionEngine()
      const state = makeState({ flow: 'idle' })
      const result = await engine.execute(rejectDecision(), state, makeInput())

      expect(result.nextState.flow).toBe('idle')
    })
  })

  // ── execute_immediately ────────────────────────────────────────────────────

  describe('execute_immediately decision', () => {
    it('calls the tool and returns success result', async () => {
      const tool   = new MockTool({ success: true, result: 'Cita creada.' })
      const engine = new ExecutionEngine(tool)
      const result = await engine.execute(immediateDecision('confirm_booking'), makeState(), makeInput())

      expect(result.text).toBe('Cita creada.')
      expect(result.actionPerformed).toBe(true)
      expect(result.toolTrace).toHaveLength(1)
      expect(result.toolTrace[0]!.tool).toBe('confirm_booking')
      expect(result.nextState.flow).toBe('idle')
    })

    it('returns unauthorized for external role trying to access restricted tool', async () => {
      const engine = new ExecutionEngine()
      const input  = makeInput({ userRole: 'external' })
      const result = await engine.execute(immediateDecision('create_client'), makeState(), input)

      expect(result.actionPerformed).toBe(false)
      expect(result.text).toContain('permisos')
    })

    it('records tool duration in trace', async () => {
      const engine = new ExecutionEngine(new MockTool())
      const result = await engine.execute(immediateDecision(), makeState(), makeInput())

      expect(result.toolTrace[0]!.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('resets draft and missingFields after successful action', async () => {
      const engine = new ExecutionEngine(new MockTool({ success: true, result: 'ok' }))
      const state  = makeState({ draft: { clientName: 'María' }, missingFields: ['date'] })
      const result = await engine.execute(immediateDecision(), state, makeInput())

      expect(result.nextState.draft).toBeNull()
      expect(result.nextState.missingFields).toHaveLength(0)
    })

    it('keeps state intact when tool fails', async () => {
      const tool   = new MockTool({ success: false, result: 'Error al agendar.' })
      const engine = new ExecutionEngine(tool)
      const state  = makeState({ flow: 'collecting_booking' })
      const result = await engine.execute(immediateDecision(), state, makeInput())

      expect(result.actionPerformed).toBe(false)
      expect(result.nextState.flow).toBe('collecting_booking')
    })
  })

  // ── reason_with_llm: text response ─────────────────────────────────────────

  describe('reason_with_llm — text response', () => {
    it('returns LLM text content when no tool call', async () => {
      const llm    = new SequenceLlm([{ content: 'Buenos días, ¿en qué te ayudo?' }])
      const engine = new ExecutionEngine(new MockTool(), llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput())

      expect(result.text).toBe('Buenos días, ¿en qué te ayudo?')
      expect(result.actionPerformed).toBe(false)
    })

    it('accumulates tokens from LLM response', async () => {
      const llm    = new SequenceLlm([{ content: 'Hola', tokens: 42 }])
      const engine = new ExecutionEngine(new MockTool(), llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput())

      expect(result.tokens).toBe(42)
    })

    it('returns llmMessages for history propagation', async () => {
      const llm    = new SequenceLlm([{ content: 'Claro.' }])
      const engine = new ExecutionEngine(new MockTool(), llm)
      const decision = llmDecision([
        { role: 'system', content: 'sys' },
        { role: 'user',   content: 'hola' },
      ])
      const result = await engine.execute(decision, makeState(), makeInput())

      // llmMessages should contain what was added during this turn
      expect(result.llmMessages).toBeDefined()
      expect(result.llmMessages!.length).toBeGreaterThan(0)
      expect(result.llmMessages!.some((m) => m.role === 'assistant')).toBe(true)
    })
  })

  // ── reason_with_llm: tool call ─────────────────────────────────────────────

  describe('reason_with_llm — tool call then text', () => {
    it('executes tool and produces final text from second LLM turn', async () => {
      const llm = new SequenceLlm([
        {
          content: null,
          tool_calls: [{
            id:       'call-1',
            type:     'function' as const,
            function: { name: 'get_services', arguments: '{}' },
          }],
          tokens: 30,
        },
        { content: 'Los servicios son: Corte.', tokens: 20 },
      ])
      const tool   = new MockTool({ success: true, result: 'Servicios: Corte ($20).' })
      const engine = new ExecutionEngine(tool, llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput())

      expect(result.text).toBe('Los servicios son: Corte.')
      expect(result.toolTrace).toHaveLength(1)
      expect(result.toolTrace[0]!.tool).toBe('get_services')
      expect(result.tokens).toBe(50)
    })

    it('marks actionPerformed=true when tool succeeds', async () => {
      const llm = new SequenceLlm([
        {
          content: null,
          tool_calls: [{
            id:       'call-2',
            type:     'function' as const,
            function: { name: 'confirm_booking', arguments: JSON.stringify({ service_id: 'svc-1', date: '2026-05-01', time: '10:00' }) },
          }],
        },
        { content: 'Cita confirmada.' },
      ])
      const tool   = new MockTool({ success: true, result: 'Listo.' })
      const engine = new ExecutionEngine(tool, llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput())

      expect(result.actionPerformed).toBe(true)
    })

    it('blocks unauthorized tool in reasoning loop', async () => {
      const llm = new SequenceLlm([
        {
          content: null,
          tool_calls: [{
            id:       'call-3',
            type:     'function' as const,
            function: { name: 'create_client', arguments: '{"name":"Test"}' },
          }],
        },
        { content: 'No se pudo registrar.' },
      ])
      const engine = new ExecutionEngine(new MockTool(), llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput({ userRole: 'external' }))

      // Tool trace shows unauthorized
      expect(result.toolTrace[0]!.success).toBe(false)
      expect(result.toolTrace[0]!.result).toContain('Unauthorized')
    })

    it('handles malformed tool arguments gracefully', async () => {
      const llm = new SequenceLlm([
        {
          content: null,
          tool_calls: [{
            id:       'call-4',
            type:     'function' as const,
            function: { name: 'confirm_booking', arguments: 'NOT_JSON{{{' },
          }],
        },
        { content: 'Perdón, algo falló.' },
      ])
      const engine = new ExecutionEngine(new MockTool(), llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput())

      // Should not throw — malformed args become {}
      expect(result.text).toBe('Perdón, algo falló.')
    })
  })

  // ── Token fallback estimate ─────────────────────────────────────────────────

  describe('token estimation fallback', () => {
    it('uses word-count estimate when LLM returns 0 tokens', async () => {
      const llm    = new SequenceLlm([{ content: 'Hola cómo estás', tokens: 0 }])
      const engine = new ExecutionEngine(new MockTool(), llm)
      const result = await engine.execute(llmDecision(), makeState(), makeInput())

      // Falls back to step * 200 + word count — anything > 0
      expect(result.tokens).toBeGreaterThan(0)
    })
  })
})
