/**
 * ai-orchestrator.test.ts
 *
 * Integration tests for AiOrchestrator.process():
 *   - Full pipeline: state → decision → execution → state persistence
 *   - Turn counter increment and reset after action
 *   - History propagation (condensed + full tool-call chain)
 *   - Abort on turn limit
 *   - Reset flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AiOrchestrator } from '@/lib/ai/orchestrator/ai-orchestrator'
import { InMemoryStateManager } from '@/lib/ai/orchestrator/state-manager'
import { DecisionEngine } from '@/lib/ai/orchestrator/decision-engine'
import { ExecutionEngine, type IToolExecutor, type IMockLlmProvider } from '@/lib/ai/orchestrator/execution-engine'
import type { AiInput, ConversationState } from '@/lib/ai/orchestrator/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<AiInput> = {}): AiInput {
  return {
    text:       'hola',
    userId:     'user-test',
    businessId: 'biz-test',
    userRole:   'owner',
    timezone:   'America/Bogota',
    channel:    'web',
    history:    [],
    context: {
      businessId:   'biz-test',
      businessName: 'Test Salon',
      timezone:     'America/Bogota',
      services:     [{ id: 'svc-1', name: 'Corte', duration_min: 30, price: 20 }],
    },
    ...overrides,
  }
}

class AlwaysSucceedTool implements IToolExecutor {
  async execute(): Promise<{ success: boolean; result: string }> {
    return { success: true, result: 'Acción completada con éxito.' }
  }
}

class AlwaysFailTool implements IToolExecutor {
  async execute(): Promise<{ success: boolean; result: string }> {
    return { success: false, result: 'Error al ejecutar.' }
  }
}

class FixedTextLlm implements IMockLlmProvider {
  constructor(private text: string) {}
  async chat(): Promise<{ content: string; tokens?: number }> {
    return { content: this.text, tokens: 25 }
  }
}

class ToolCallLlm implements IMockLlmProvider {
  private callCount = 0
  async chat(): Promise<{ content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tokens?: number }> {
    this.callCount++
    if (this.callCount === 1) {
      return {
        content: null,
        tool_calls: [{
          id:       'tc-1',
          type:     'function' as const,
          function: { name: 'confirm_booking', arguments: JSON.stringify({ service_id: 'svc-1', date: '2026-05-01', time: '10:00', client_name: 'María' }) },
        }],
        tokens: 40,
      }
    }
    return { content: 'Listo, agendé a María.', tokens: 20 }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Unique ID counter so each buildOrchestrator call gets isolated state keys
let _testCounter = 0

describe('AiOrchestrator', () => {

  function buildOrchestrator(options: {
    llm?: IMockLlmProvider
    tool?: IToolExecutor
  } = {}) {
    const id         = ++_testCounter
    const userId     = `user-test-${id}`
    const businessId = `biz-test-${id}`
    const sm         = new InMemoryStateManager()
    const de         = new DecisionEngine()
    const ee         = new ExecutionEngine(
      options.tool ?? new AlwaysSucceedTool(),
      options.llm  ?? new FixedTextLlm('Entendido.'),
    )

    /** Returns an AiInput bound to this orchestrator's userId/businessId. */
    function makeTestInput(overrides: Partial<AiInput> = {}): AiInput {
      return makeInput({ userId, businessId, context: { ...makeInput().context, businessId }, ...overrides })
    }

    return { orchestrator: new AiOrchestrator(sm, de, ee), sm, userId, businessId, makeTestInput }
  }

  // ── Basic response ──────────────────────────────────────────────────────────

  describe('basic response', () => {
    it('returns a text response for a simple greeting', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator({ llm: new FixedTextLlm('¡Hola! ¿En qué te ayudo?') })
      const output = await orchestrator.process(makeTestInput({ text: 'hola' }))

      expect(output.text).toBe('¡Hola! ¿En qué te ayudo?')
      expect(output.actionPerformed).toBe(false)
    })

    it('returns state with the conversation session', async () => {
      const { orchestrator, makeTestInput, userId, businessId } = buildOrchestrator()
      const output = await orchestrator.process(makeTestInput())

      expect(output.state.userId).toBe(userId)
      expect(output.state.businessId).toBe(businessId)
      expect(output.state.sessionId).toBeTruthy()
    })
  })

  // ── Turn counter ────────────────────────────────────────────────────────────

  describe('turn counter', () => {
    it('increments turnCount each call', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator()
      const input = makeTestInput()

      const r1 = await orchestrator.process(input)
      const r2 = await orchestrator.process({ ...input, history: r1.history })

      expect(r2.state.turnCount).toBe(2)
    })

    it('aborts and returns error text when turn limit exceeded', async () => {
      const { orchestrator, sm, makeTestInput } = buildOrchestrator()
      const input = makeTestInput()

      // Warm up a state and push turnCount to maxTurns - 1
      const first = await orchestrator.process(input)
      const state = first.state
      state.turnCount  = 5 // one below abort threshold (maxTurns = 6)
      state.flow       = 'collecting_booking'
      await sm.persist(state)

      const output = await orchestrator.process({ ...input, history: first.history })
      expect(output.text).toContain('empieza de nuevo')
      expect(output.actionPerformed).toBe(false)
    })

    it('resets turnCount to 0 after successful action', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator({
        tool: new AlwaysSucceedTool(),
        llm:  new ToolCallLlm(),
      })
      const input = makeTestInput({ text: 'quiero agendar un corte para el 2026-05-01 a las 10:00 para María' })
      const output = await orchestrator.process(input)

      // After successful booking, turnCount should be reset
      expect(output.state.turnCount).toBe(0)
    })
  })

  // ── History propagation ─────────────────────────────────────────────────────

  describe('history propagation', () => {
    it('adds user + assistant messages to history', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator({ llm: new FixedTextLlm('Claro.') })
      const output = await orchestrator.process(makeTestInput({ text: 'Hola' }))

      const history = output.history
      expect(history.some((m) => m.role === 'user')).toBe(true)
      expect(history.some((m) => m.role === 'assistant')).toBe(true)
    })

    it('caps history at 20 messages', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator({ llm: new FixedTextLlm('ok') })

      // Seed 20 messages as existing history
      const longHistory = Array.from({ length: 20 }, (_, i) => ({
        role:    (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `msg ${i}`,
      }))

      const output = await orchestrator.process(makeTestInput({ history: longHistory }))
      expect(output.history.length).toBeLessThanOrEqual(20)
    })

    it('includes full tool-call chain in history when tools were used', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator({
        tool: new AlwaysSucceedTool(),
        llm:  new ToolCallLlm(),
      })
      const output = await orchestrator.process(makeTestInput({ text: 'quiero agendar un corte para el 2026-05-01 a las 10:00 para María' }))

      // History should contain tool result messages (not just user+assistant)
      const toolMessages = output.history.filter((m) => m.role === 'tool')
      expect(toolMessages.length).toBeGreaterThan(0)
    })
  })

  // ── Confirmation flow ───────────────────────────────────────────────────────

  describe('confirmation flow', () => {
    it('executes immediately when state is awaiting_confirmation and user says sí', async () => {
      const { orchestrator, sm, makeTestInput } = buildOrchestrator({ tool: new AlwaysSucceedTool() })

      // Set up state as awaiting_confirmation
      const seed  = await orchestrator.process(makeTestInput())
      const state = seed.state
      state.flow       = 'awaiting_confirmation'
      state.lastIntent = 'confirm_booking'
      state.draft      = { clientName: 'Pedro', date: '2026-05-01', time: '10:00' }
      await sm.persist(state)

      const output = await orchestrator.process(makeTestInput({ text: 'sí', history: seed.history }))

      expect(output.actionPerformed).toBe(true)
      expect(output.state.flow).toBe('idle')
    })
  })

  // ── Reset ───────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('resets conversation state to idle', async () => {
      const { orchestrator, sm, makeTestInput, userId, businessId } = buildOrchestrator()

      await orchestrator.process(makeTestInput())

      // Set some state
      const loaded = await sm.load(userId, businessId)
      if (loaded) {
        loaded.flow       = 'collecting_booking'
        loaded.turnCount  = 4
        await sm.persist(loaded)
      }

      await orchestrator.reset(userId, businessId)

      const afterReset = await sm.load(userId, businessId)
      expect(afterReset?.flow).toBe('idle')
      expect(afterReset?.turnCount).toBe(0)
    })
  })

  // ── Token reporting ─────────────────────────────────────────────────────────

  describe('token reporting', () => {
    it('reports tokens in output', async () => {
      const { orchestrator, makeTestInput } = buildOrchestrator({ llm: new FixedTextLlm('ok') })
      const output = await orchestrator.process(makeTestInput())

      expect(output.tokens).toBeGreaterThan(0)
    })
  })
})
