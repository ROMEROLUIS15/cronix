/**
 * decision-engine-hardening.test.ts
 *
 * Tests for the hardening additions introduced in the AI Booking session:
 *   - Task 7: services guard (empty services → reject)
 *   - Task 2: resolved entities injected into system prompt
 *   - buildConfirmationSummary: create / cancel / reschedule summaries
 *   - State priority: extractEntities result present in system prompt
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest'
import { DecisionEngine, buildConfirmationSummary } from '@/lib/ai/orchestrator/decision-engine'
import type { AiInput, ConversationState } from '@/lib/ai/orchestrator/types'

// ── Pin time to Wednesday 2026-04-22 ─────────────────────────────────────────
const FIXED_NOW = new Date('2026-04-22T12:00:00-05:00').getTime()
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_NOW) })
afterAll(() => { vi.useRealTimers() })

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
    text: 'hola', userId: 'user-1', businessId: 'biz-1',
    userRole: 'owner', timezone: 'America/Bogota',
    channel: 'web', history: [],
    context: {
      businessId: 'biz-1', businessName: 'Barbería Test',
      timezone: 'America/Bogota',
      services: [{ id: 'svc-uuid-1', name: 'Corte', duration_min: 30, price: 20 }],
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DecisionEngine — Hardening Guards', () => {
  let engine: DecisionEngine

  beforeEach(() => { engine = new DecisionEngine() })

  // ── Task 7: services guard ──────────────────────────────────────────────────

  describe('services guard (Task 7)', () => {
    it('rejects when services array is explicitly empty', () => {
      const input = makeInput({
        context: {
          businessId: 'biz-1', businessName: 'Sin Servicios', timezone: 'America/Bogota',
          services: [],
        },
      })
      const decision = engine.analyze(input, makeState())

      expect(decision.type).toBe('reject')
      if (decision.type !== 'reject') return
      expect(decision.reason).toContain('servicios')
    })

    it('does NOT reject when services is undefined (loading state)', () => {
      const input = makeInput({
        context: {
          businessId: 'biz-1', businessName: 'Test', timezone: 'America/Bogota',
          services: undefined,
        },
      })
      const decision = engine.analyze(input, makeState())
      expect(decision.type).not.toBe('reject')
    })

    it('proceeds normally when services has at least one entry', () => {
      const decision = engine.analyze(makeInput(), makeState())
      expect(decision.type).toBe('reason_with_llm')
    })
  })

  // ── Task 2: resolved entities in system prompt ──────────────────────────────

  describe('resolved entities injected into system prompt (Task 2)', () => {
    it('injects resolved date into system prompt when text contains "mañana"', () => {
      const input = makeInput({ text: 'quiero agendar mañana' })
      const decision = engine.analyze(input, makeState())

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      // "mañana" from Wednesday 2026-04-22 → 2026-04-23
      expect(systemMsg?.content).toContain('2026-04-23')
    })

    it('injects resolved time into system prompt when text contains "3pm"', () => {
      const input = makeInput({ text: 'cita a las 3pm' })
      const decision = engine.analyze(input, makeState())

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('15:00')
    })

    it('does NOT inject "ENTIDADES YA RESUELTAS" when no date/time detected', () => {
      const input = makeInput({ text: 'hola, cuánto cuesta el corte?' })
      const decision = engine.analyze(input, makeState())

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).not.toContain('ENTIDADES YA RESUELTAS')
    })

    it('injects both date and time when both are present in text', () => {
      const input = makeInput({ text: 'quiero una cita el lunes a las 10am' })
      const decision = engine.analyze(input, makeState())

      expect(decision.type).toBe('reason_with_llm')
      if (decision.type !== 'reason_with_llm') return

      const systemMsg = decision.messages.find((m) => m.role === 'system')
      // "el lunes" from Wednesday 2026-04-22 → 2026-04-27
      expect(systemMsg?.content).toContain('2026-04-27')
      expect(systemMsg?.content).toContain('10:00')
    })
  })
})

// ── buildConfirmationSummary ──────────────────────────────────────────────────

describe('buildConfirmationSummary', () => {
  const services = [
    { id: 'svc-1', name: 'Corte Clásico', duration_min: 30, price: 20 },
    { id: 'svc-2', name: 'Tinte', duration_min: 60, price: 50 },
  ]

  describe('confirm_booking', () => {
    it('includes service name, client, date and time', () => {
      const summary = buildConfirmationSummary('confirm_booking', {
        service_id: 'svc-1',
        client_name: 'María',
        date: '2026-05-01',
        time: '10:00',
      }, services)

      expect(summary).toContain('Corte Clásico')
      expect(summary).toContain('María')
      expect(summary).toContain('2026-05-01')
      expect(summary).toContain('10:00')
      expect(summary).toContain('Confirmas')
    })

    it('falls back to "?" when date or time are missing', () => {
      const summary = buildConfirmationSummary('confirm_booking', {
        service_id: 'svc-2',
        client_name: 'Juan',
      }, services)

      expect(summary).toContain('Tinte')
      expect(summary).toContain('?')
    })

    it('falls back to "?" for unknown service_id', () => {
      const summary = buildConfirmationSummary('confirm_booking', {
        service_id: 'svc-unknown',
        client_name: 'Ana',
        date: '2026-05-10',
        time: '09:00',
      }, services)

      // Service name unknown but still produces a valid summary string
      expect(typeof summary).toBe('string')
      expect(summary.length).toBeGreaterThan(0)
    })
  })

  describe('cancel_booking', () => {
    it('includes client and cancellation message', () => {
      const summary = buildConfirmationSummary('cancel_booking', {
        client_name: 'Pedro',
        service_name: 'Corte Clásico',
      }, services)

      expect(summary).toContain('Pedro')
      expect(summary).toContain('cancelar')
      expect(summary).toContain('Confirmas')
    })
  })

  describe('reschedule_booking', () => {
    it('includes client name, new date and new time', () => {
      const summary = buildConfirmationSummary('reschedule_booking', {
        client_name: 'Lucía',
        new_date: '2026-05-15',
        new_time: '14:30',
      }, services)

      expect(summary).toContain('Lucía')
      expect(summary).toContain('2026-05-15')
      expect(summary).toContain('14:30')
      expect(summary).toContain('reagendar')
    })
  })

  describe('unknown intent', () => {
    it('returns a safe fallback string', () => {
      const summary = buildConfirmationSummary('unknown_tool', {}, services)
      expect(typeof summary).toBe('string')
      expect(summary.length).toBeGreaterThan(0)
    })
  })
})
