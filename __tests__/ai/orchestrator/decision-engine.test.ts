/**
 * decision-engine.test.ts
 *
 * Tests for DecisionEngine.analyze():
 *   - Turn limit enforcement
 *   - Confirmation / rejection detection
 *   - Booking intent detection
 *   - Default LLM reasoning path
 *   - System prompt content (services, working hours, today date)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DecisionEngine } from '@/lib/ai/orchestrator/decision-engine'
import type { AiInput, ConversationState } from '@/lib/ai/orchestrator/types'

// ── Helpers ─────────────────────────────────────────────────────────────────

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
      services: [
        { id: 'svc-uuid-1', name: 'Corte', duration_min: 30, price: 20 },
      ],
    },
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DecisionEngine', () => {
  let engine: DecisionEngine

  beforeEach(() => {
    engine = new DecisionEngine()
  })

  // ── Turn limit ──────────────────────────────────────────────────────────────

  describe('turn limit', () => {
    it('returns reject when turnCount >= maxTurns and flow is not idle', () => {
      const state = makeState({ flow: 'collecting_booking', turnCount: 6, maxTurns: 6 })
      const input = makeInput({ text: 'agendar' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reject')
    })

    it('does NOT reject when flow is idle (reset path)', () => {
      const state = makeState({ flow: 'idle', turnCount: 6, maxTurns: 6 })
      const input = makeInput({ text: 'hola' })
      const decision = engine.analyze(input, state)

      expect(decision.type).not.toBe('reject')
    })
  })

  // ── Awaiting confirmation ───────────────────────────────────────────────────

  describe('awaiting_confirmation flow', () => {
    it('returns execute_immediately on "sí"', () => {
      const state = makeState({ flow: 'awaiting_confirmation', lastIntent: 'confirm_booking' })
      const input = makeInput({ text: 'sí' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('execute_immediately')
    })

    it('returns execute_immediately on "dale"', () => {
      const state = makeState({ flow: 'awaiting_confirmation', lastIntent: 'cancel_booking' })
      const input = makeInput({ text: 'dale' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('execute_immediately')
    })

    it('returns reject on "no"', () => {
      const state = makeState({ flow: 'awaiting_confirmation' })
      const input = makeInput({ text: 'no' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reject')
    })

    it('returns reject on "mejor no"', () => {
      const state = makeState({ flow: 'awaiting_confirmation' })
      const input = makeInput({ text: 'mejor no' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reject')
    })

    it('falls through to LLM reasoning on unrelated text', () => {
      const state = makeState({ flow: 'awaiting_confirmation' })
      const input = makeInput({ text: 'qué servicios tienen?' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
    })
  })

  // ── Booking intent ──────────────────────────────────────────────────────────

  describe('booking intent detection', () => {
    const bookingPhrases = [
      'quiero agendar una cita',
      'necesito agendar',
      'reserva para mañana',
      'nueva cita para el lunes',
      'programar una cita',
    ]

    for (const phrase of bookingPhrases) {
      it(`routes "${phrase}" to reason_with_llm`, () => {
        const state = makeState()
        const input = makeInput({ text: phrase })
        const decision = engine.analyze(input, state)

        expect(decision.type).toBe('reason_with_llm')
      })
    }
  })

  // ── Collecting flows → LLM ──────────────────────────────────────────────────

  describe('collecting flows', () => {
    it('routes collecting_booking to reason_with_llm', () => {
      const state = makeState({ flow: 'collecting_booking' })
      const input = makeInput({ text: 'para el martes' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
    })

    it('routes collecting_reschedule to reason_with_llm', () => {
      const state = makeState({ flow: 'collecting_reschedule' })
      const input = makeInput({ text: 'el jueves a las 10' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
    })
  })

  // ── Default path ────────────────────────────────────────────────────────────

  describe('default path', () => {
    it('returns reason_with_llm for idle + unrecognized text', () => {
      const state = makeState()
      const input = makeInput({ text: 'cuánto cuesta el tinte?' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
    })
  })

  // ── Tool defs structure ─────────────────────────────────────────────────────

  describe('tool definitions', () => {
    it('includes confirm_booking in tool defs for owner role', () => {
      const state = makeState()
      const input = makeInput({ userRole: 'owner' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const names = decision.toolDefs.map((t) => t.function.name)
      expect(names).toContain('confirm_booking')
      expect(names).toContain('create_client')
      expect(names).toContain('get_available_slots')
    })

    it('excludes create_client for external role', () => {
      const state = makeState()
      const input = makeInput({ userRole: 'external' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const names = decision.toolDefs.map((t) => t.function.name)
      expect(names).not.toContain('create_client')
      expect(names).toContain('confirm_booking')
    })

    it('confirm_booking required fields do NOT include client_name', () => {
      const state = makeState()
      const input = makeInput({ userRole: 'owner' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const bookingTool = decision.toolDefs.find((t) => t.function.name === 'confirm_booking')
      expect(bookingTool).toBeDefined()
      expect(bookingTool!.function.parameters.required).not.toContain('client_name')
      expect(bookingTool!.function.parameters.required).toContain('service_id')
      expect(bookingTool!.function.parameters.required).toContain('date')
      expect(bookingTool!.function.parameters.required).toContain('time')
    })
  })

  // ── System prompt content ───────────────────────────────────────────────────

  describe('system prompt', () => {
    it('injects business name into system prompt', () => {
      const state = makeState()
      const input = makeInput()
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('Barbería Test')
    })

    it('injects service name and id into system prompt', () => {
      const state = makeState()
      const input = makeInput()
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('Corte')
      expect(systemMsg?.content).toContain('svc-uuid-1')
    })

    it('injects working hours into system prompt when configured', () => {
      const state = makeState()
      const input = makeInput({
        context: {
          businessId:   'biz-1',
          businessName: 'Test',
          timezone:     'America/Bogota',
          workingHours: {
            monday: { open: '09:00', close: '18:00' },
          },
        },
      })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('09:00')
      expect(systemMsg?.content).toContain('18:00')
      expect(systemMsg?.content).toContain('Lunes')
    })

    it('includes today date in system prompt', () => {
      const state = makeState()
      const input = makeInput()
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      const todayISO = new Date().toISOString().split('T')[0]!
      expect(systemMsg?.content).toContain(todayISO)
    })

    it('includes AI rules when configured', () => {
      const state = makeState()
      const input = makeInput({
        context: {
          businessId:   'biz-1',
          businessName: 'Test',
          timezone:     'America/Bogota',
          aiRules:      'No agendar sin depósito',
        },
      })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('No agendar sin depósito')
    })
  })

  // ── Messages array ──────────────────────────────────────────────────────────

  describe('messages array', () => {
    it('places system prompt first, user text last', () => {
      const state = makeState()
      const input = makeInput({ text: 'hola' })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      expect(decision.messages[0]!.role).toBe('system')
      expect(decision.messages.at(-1)!.role).toBe('user')
      expect(decision.messages.at(-1)!.content).toBe('hola')
    })

    it('includes history messages between system and user', () => {
      const state = makeState()
      const input = makeInput({
        text: 'sí, para el martes',
        history: [
          { role: 'user', content: 'quiero agendar' },
          { role: 'assistant', content: 'Claro, ¿qué servicio?' },
        ],
      })
      const decision = engine.analyze(input, state)

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      expect(decision.messages).toHaveLength(4) // system + 2 history + user
    })
  })
})
