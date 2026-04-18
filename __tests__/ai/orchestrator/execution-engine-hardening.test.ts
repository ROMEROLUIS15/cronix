/**
 * execution-engine-hardening.test.ts
 *
 * Integration tests for the hardening guards added to ExecutionEngine:
 *   - Task 1: Availability claim guard (LLM claims availability without read tool)
 *   - Task 3: Confirmation interception (write tool blocked → awaiting_confirmation)
 *   - Task 4: State priority — UUID fields locked from draft
 *   - Task 5: Write-action guard (LLM claims booking without write tool)
 *
 * Uses the IMockLlmProvider + IToolExecutor interfaces to avoid real network calls.
 */

import { describe, it, expect } from 'vitest'
import {
  ExecutionEngine,
  type IToolExecutor,
  type IMockLlmProvider,
  type MockLlmResponse,
  type ToolExecuteParams,
} from '@/lib/ai/orchestrator/execution-engine'
import type { Decision, ConversationState, AiInput } from '@/lib/ai/orchestrator/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  const now = new Date().toISOString()
  return {
    sessionId: 'sess-1', userId: 'user-1', businessId: 'biz-1',
    channel: 'web', flow: 'idle', draft: null, missingFields: [],
    lastIntent: null, lastToolCalls: null,
    turnCount: 0, maxTurns: 6,
    createdAt: now, updatedAt: now,
    ...overrides,
  }
}

function makeInput(overrides: Partial<AiInput> = {}): AiInput {
  return {
    text: 'quiero agendar', userId: 'user-1', businessId: 'biz-1',
    userRole: 'owner', timezone: 'America/Bogota',
    channel: 'web', history: [],
    context: {
      businessId: 'biz-1', businessName: 'Test', timezone: 'America/Bogota',
      services: [{ id: 'svc-1', name: 'Corte', duration_min: 30, price: 20 }],
    },
    ...overrides,
  }
}

function llmDecision(messages = [{ role: 'system' as const, content: 'test' }]): Extract<Decision, { type: 'reason_with_llm' }> {
  return { type: 'reason_with_llm', messages, toolDefs: [] }
}

class MockTool implements IToolExecutor {
  constructor(private resp = { success: true, result: 'OK.' }) {}
  async execute(_params: ToolExecuteParams): Promise<{ success: boolean; result: string }> {
    return this.resp
  }
}

class SequenceLlm implements IMockLlmProvider {
  private queue: MockLlmResponse[]
  constructor(responses: MockLlmResponse[]) { this.queue = [...responses] }
  async chat(): Promise<MockLlmResponse> {
    return this.queue.shift() ?? { content: 'fallback' }
  }
}

// ── Task 5: Write-action guard ────────────────────────────────────────────────

describe('ExecutionEngine — Write-action claim guard (Task 5)', () => {
  it('blocks LLM response claiming "agendé" without calling confirm_booking', async () => {
    // LLM produces a text response claiming it booked — no tool call was made
    const llm    = new SequenceLlm([{ content: 'Listo, agendé la cita para el martes.' }])
    const engine = new ExecutionEngine(new MockTool(), llm)
    const result = await engine.execute(llmDecision(), makeState(), makeInput())

    // Must NOT let the LLM hallucination through
    expect(result.actionPerformed).toBe(false)
    expect(result.text).not.toContain('agendé la cita para el martes')
  })

  it('blocks LLM response claiming "cancelé" without calling cancel_booking', async () => {
    const llm    = new SequenceLlm([{ content: 'He cancelado la cita de María.' }])
    const engine = new ExecutionEngine(new MockTool(), llm)
    const result = await engine.execute(llmDecision(), makeState(), makeInput())

    expect(result.actionPerformed).toBe(false)
    expect(result.text).not.toContain('cancelado la cita de María')
  })

  it('allows legitimate LLM response after confirm_booking was actually called', async () => {
    // LLM calls the tool, then produces the confirmation text
    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-1', type: 'function' as const,
          function: { name: 'confirm_booking', arguments: JSON.stringify({ service_id: 'svc-1', date: '2026-05-01', time: '10:00' }) },
        }],
      },
      { content: 'Listo, agendé la cita.' },
    ])
    const engine = new ExecutionEngine(new MockTool({ success: true, result: 'OK' }), llm)
    // Owner role: executes without interception
    const result = await engine.execute(llmDecision(), makeState({ flow: 'awaiting_confirmation' }), makeInput())

    expect(result.text).toBe('Listo, agendé la cita.')
    expect(result.actionPerformed).toBe(true)
  })
})

// ── Task 1: Availability claim guard ─────────────────────────────────────────

describe('ExecutionEngine — Availability claim guard (Task 1)', () => {
  it('blocks LLM claiming "hay disponibilidad" without calling get_available_slots', async () => {
    const llm    = new SequenceLlm([{ content: 'Sí, hay disponibilidad para el lunes.' }])
    const engine = new ExecutionEngine(new MockTool(), llm)
    const result = await engine.execute(llmDecision(), makeState(), makeInput())

    expect(result.text).not.toContain('hay disponibilidad para el lunes')
    expect(result.actionPerformed).toBe(false)
  })

  it('blocks "tienes disponible" hallucination', async () => {
    const llm    = new SequenceLlm([{ content: 'Tienes disponible el martes a las 3pm.' }])
    const engine = new ExecutionEngine(new MockTool(), llm)
    const result = await engine.execute(llmDecision(), makeState(), makeInput())

    expect(result.text).not.toContain('Tienes disponible')
  })

  it('allows availability response when get_available_slots was actually called', async () => {
    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-av', type: 'function' as const,
          function: { name: 'get_available_slots', arguments: '{"date":"2026-05-01"}' },
        }],
      },
      { content: 'Hay disponibilidad: 10:00, 14:00 y 16:00.' },
    ])
    const engine = new ExecutionEngine(new MockTool({ success: true, result: '["10:00","14:00"]' }), llm)
    const result = await engine.execute(llmDecision(), makeState(), makeInput())

    expect(result.text).toBe('Hay disponibilidad: 10:00, 14:00 y 16:00.')
  })
})

// ── Task 3: Confirmation interception ────────────────────────────────────────

describe('ExecutionEngine — Confirmation interception (Task 3)', () => {

  // For external/employee roles (requiresConfirmation = true)
  it('intercepts confirm_booking for external role and transitions to awaiting_confirmation', async () => {
    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-book', type: 'function' as const,
          function: {
            name: 'confirm_booking',
            arguments: JSON.stringify({ service_id: 'svc-1', client_name: 'Ana', date: '2026-05-10', time: '10:00' }),
          },
        }],
      },
    ])
    const engine = new ExecutionEngine(new MockTool(), llm)
    const result = await engine.execute(
      llmDecision(),
      makeState({ flow: 'collecting_booking' }),   // NOT awaiting_confirmation
      makeInput({ userRole: 'external' }),          // requiresConfirmation = true
    )

    // Tool must NOT have been executed
    expect(result.actionPerformed).toBe(false)
    // State should transition to awaiting_confirmation
    expect(result.nextState.flow).toBe('awaiting_confirmation')
    expect(result.nextState.lastIntent).toBe('confirm_booking')
    // Summary must mention service and date
    expect(result.text).toContain('Corte')
    expect(result.text).toContain('2026-05-10')
    expect(result.text).toContain('Ana')
  })

  it('does NOT intercept for owner role (requiresConfirmation = false)', async () => {
    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-book-owner', type: 'function' as const,
          function: {
            name: 'confirm_booking',
            arguments: JSON.stringify({ service_id: 'svc-1', date: '2026-05-10', time: '10:00' }),
          },
        }],
      },
      { content: 'Cita agendada para el 10 de mayo.' },
    ])
    const engine = new ExecutionEngine(new MockTool({ success: true, result: 'OK' }), llm)
    const result = await engine.execute(
      llmDecision(),
      makeState({ flow: 'collecting_booking' }),
      makeInput({ userRole: 'owner' }),             // requiresConfirmation = false
    )

    // Owner skips confirmation — tool executes directly
    expect(result.nextState.flow).not.toBe('awaiting_confirmation')
    expect(result.actionPerformed).toBe(true)
  })

  it('executes tool when state is ALREADY awaiting_confirmation (confirmed path)', async () => {
    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-confirmed', type: 'function' as const,
          function: {
            name: 'confirm_booking',
            arguments: JSON.stringify({ service_id: 'svc-1', date: '2026-05-10', time: '10:00' }),
          },
        }],
      },
      { content: 'Cita confirmada.' },
    ])
    const engine = new ExecutionEngine(new MockTool({ success: true, result: 'OK' }), llm)
    const result = await engine.execute(
      llmDecision(),
      makeState({ flow: 'awaiting_confirmation' }),  // already confirmed
      makeInput({ userRole: 'external' }),
    )

    // No interception — user already said "sí".
    // The reasoning loop executes the tool directly (no second interception because
    // state.flow === 'awaiting_confirmation'). Flow reset to 'idle' is done by
    // executeImmediate, not by the reasoning loop — so we only assert that the
    // tool was actually called and actionPerformed is true.
    expect(result.actionPerformed).toBe(true)
    expect(result.toolTrace.length).toBeGreaterThan(0)
    expect(result.toolTrace[0]!.tool).toBe('confirm_booking')
  })
})

// ── Task 4: UUID state priority ───────────────────────────────────────────────

describe('ExecutionEngine — UUID state priority (Task 4)', () => {
  it('locks service_id from state.draft even when LLM provides a different one', async () => {
    let capturedArgs: Record<string, unknown> = {}

    const capturingTool: IToolExecutor = {
      async execute(params: ToolExecuteParams) {
        capturedArgs = params.args
        return { success: true, result: 'OK' }
      },
    }

    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-uuid', type: 'function' as const,
          function: {
            name: 'confirm_booking',
            // LLM uses a different (wrong) service_id
            arguments: JSON.stringify({ service_id: 'svc-WRONG', date: '2026-05-10', time: '10:00' }),
          },
        }],
      },
      { content: 'Listo.' },
    ])

    const engine = new ExecutionEngine(capturingTool, llm)
    await engine.execute(
      llmDecision(),
      makeState({
        flow: 'awaiting_confirmation',     // already confirmed → no interception
        draft: { service_id: 'svc-CORRECT' }, // draft has the locked UUID
      }),
      makeInput({ userRole: 'owner' }),
    )

    // The captured args should have the DRAFT value, not the LLM value
    expect(capturedArgs['service_id']).toBe('svc-CORRECT')
    expect(capturedArgs['service_id']).not.toBe('svc-WRONG')
  })

  it('does NOT lock non-UUID fields (date, time can be updated by LLM)', async () => {
    let capturedArgs: Record<string, unknown> = {}

    const capturingTool: IToolExecutor = {
      async execute(params: ToolExecuteParams) {
        capturedArgs = params.args
        return { success: true, result: 'OK' }
      },
    }

    const llm = new SequenceLlm([
      {
        content: null,
        tool_calls: [{
          id: 'call-nolock', type: 'function' as const,
          function: {
            name: 'confirm_booking',
            arguments: JSON.stringify({ service_id: 'svc-1', date: '2026-05-15', time: '14:00' }),
          },
        }],
      },
      { content: 'Listo.' },
    ])

    const engine = new ExecutionEngine(capturingTool, llm)
    await engine.execute(
      llmDecision(),
      makeState({
        flow: 'awaiting_confirmation',
        draft: { service_id: 'svc-1', date: '2026-05-10' }, // old date in draft
      }),
      makeInput({ userRole: 'owner' }),
    )

    // UUID locked: service_id should be 'svc-1'
    expect(capturedArgs['service_id']).toBe('svc-1')
    // date not locked: LLM's new date should win
    expect(capturedArgs['date']).toBe('2026-05-15')
  })
})
