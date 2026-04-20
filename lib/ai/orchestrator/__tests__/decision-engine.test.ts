// @ts-nocheck
/**
 * decision-engine.test.ts — Unit & Integration Tests for Decision Engine
 *
 * Tests the core orchestration logic:
 * - Intent detection (booking, cancellation, queries)
 * - Confirmation/rejection handling
 * - Owner fast-paths (zero-LLM operations)
 * - Draft completeness checks
 * - System prompt generation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DecisionEngine, buildConfirmationSummary } from '../decision-engine'
import type { AiInput, ConversationState } from '../types'

// ── Test Fixtures ────────────────────────────────────────────────────────────

const baseInput: AiInput = {
  userId: 'user-123',
  businessId: 'biz-123',
  userRole: 'external',
  userName: 'Test User',
  timezone: 'America/Bogota',
  text: 'Quiero agendar una cita',
  history: [],
  context: {
    businessName: 'Test Business',
    services: [
      { id: 'svc-1', name: 'Corte', duration_min: 30, price: 15000 },
      { id: 'svc-2', name: 'Afeitado', duration_min: 20, price: 10000 },
    ],
    workingHours: {
      monday: { open: '09:00', close: '18:00' },
      tuesday: { open: '09:00', close: '18:00' },
      wednesday: { open: '09:00', close: '18:00' },
      thursday: { open: '09:00', close: '18:00' },
      friday: { open: '09:00', close: '18:00' },
      saturday: { open: '09:00', close: '14:00' },
      sunday: null,
    },
    activeAppointments: [],
  },
}

const baseState: ConversationState = {
  flow: 'idle',
  draft: {},
  turnCount: 0,
  maxTurns: 10,
  lastIntent: null,
  lastAction: null,
}

// ── Tests: Intent Detection ──────────────────────────────────────────────────

describe('DecisionEngine — Intent Detection', () => {
  let engine: DecisionEngine

  beforeEach(() => {
    engine = new DecisionEngine()
  })

  it('[D1] Booking intent detected → routes to LLM', () => {
    const input: AiInput = { ...baseInput, text: 'Quiero agendar una cita para mañana' }
    const state: ConversationState = { ...baseState }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('reason_with_llm')
    expect((decision as any).toolDefs).toBeDefined()
    expect((decision as any).toolDefs.length).toBeGreaterThan(0)
  })

  it('[D2] Query intent detected → routes to LLM', () => {
    const input: AiInput = { ...baseInput, text: '¿Qué servicios tienen?' }
    const state: ConversationState = { ...baseState }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('reason_with_llm')
  })

  it('[D3] Confirmation (sí) in awaiting_confirmation → executes immediately', () => {
    const input: AiInput = { ...baseInput, text: 'Sí' }
    const state: ConversationState = {
      ...baseState,
      flow: 'awaiting_confirmation',
      lastIntent: 'confirm_booking',
      draft: { service_id: 'svc-1', date: '2026-04-25', time: '14:00', client_name: 'Alan' },
    }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('execute_immediately')
    expect((decision as any).intent).toBe('confirm_booking')
    expect((decision as any).args).toBeDefined()
  })

  it('[D4] Rejection (no) in awaiting_confirmation → rejects action', () => {
    const input: AiInput = { ...baseInput, text: 'No' }
    const state: ConversationState = {
      ...baseState,
      flow: 'awaiting_confirmation',
      lastIntent: 'confirm_booking',
    }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('reject')
    expect((decision as any).reason).toBeDefined()
  })
})

// ── Tests: Owner Fast-Paths ──────────────────────────────────────────────────

describe('DecisionEngine — Owner Fast-Paths', () => {
  let engine: DecisionEngine

  beforeEach(() => {
    engine = new DecisionEngine()
  })

  it('[D5] Owner: "qué tengo hoy" → query today (zero-LLM)', () => {
    const input: AiInput = {
      ...baseInput,
      userRole: 'owner',
      text: '¿Qué tengo hoy?',
    }
    const state: ConversationState = { ...baseState }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('answer_query')
    expect((decision as any).toolName).toBe('get_appointments_by_date')
  })

  it('[D6] Owner: "qué tengo mañana" → query tomorrow (zero-LLM)', () => {
    const input: AiInput = {
      ...baseInput,
      userRole: 'owner',
      text: '¿Qué tengo mañana?',
    }
    const state: ConversationState = { ...baseState }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('answer_query')
    expect((decision as any).toolName).toBe('get_appointments_by_date')
  })

  it('[D7] Owner: "cancela la última" with appointmentId → execute immediately', () => {
    const input: AiInput = {
      ...baseInput,
      userRole: 'owner',
      text: 'Cancela la última',
    }
    const state: ConversationState = {
      ...baseState,
      lastAction: {
        type: 'booking',
        clientName: 'Alan',
        serviceName: 'Corte',
        date: '2026-04-25',
        time: '14:00',
        appointmentId: 'apt-123',
      },
    }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('execute_immediately')
    expect((decision as any).intent).toBe('cancel_booking')
    expect((decision as any).args.appointment_id).toBe('apt-123')
  })

  it('[D8] Owner: Complete booking data → execute immediately (zero-LLM)', () => {
    const input: AiInput = {
      ...baseInput,
      userRole: 'owner',
      text: 'Agéndame a Carlos mañana corte a las 3',
    }
    const state: ConversationState = { ...baseState, flow: 'idle' }

    const decision = engine.analyze(input, state)

    // Should either execute immediately OR continue collection with extracted data
    expect(['execute_immediately', 'continue_collection'].includes(decision.type)).toBe(true)
  })
})

// ── Tests: Draft Management ──────────────────────────────────────────────────

describe('DecisionEngine — Draft Completeness', () => {
  let engine: DecisionEngine

  beforeEach(() => {
    engine = new DecisionEngine()
  })

  it('[D9] Collecting booking with complete draft → fast-path to await_confirmation', () => {
    const input: AiInput = { ...baseInput, text: 'Confirma' }
    const state: ConversationState = {
      ...baseState,
      flow: 'collecting_booking',
      draft: {
        service_id: 'svc-1',
        date: '2026-04-25',
        time: '14:00',
        client_name: 'Alan',
      },
    }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('await_confirmation')
    expect((decision as any).intent).toBe('confirm_booking')
  })

  it('[D10] Collecting booking with partial draft → continue collection with prompt', () => {
    const input: AiInput = { ...baseInput, text: 'Algún texto' }
    const state: ConversationState = {
      ...baseState,
      flow: 'collecting_booking',
      draft: {
        service_id: 'svc-1',
        date: '2026-04-25',
        // missing: time and client
      },
    }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('reason_with_llm')
  })
})

// ── Tests: Turn Exhaustion ───────────────────────────────────────────────────

describe('DecisionEngine — Turn Management', () => {
  let engine: DecisionEngine

  beforeEach(() => {
    engine = new DecisionEngine()
  })

  it('[D11] Turn count exhausted → reject with guidance', () => {
    const input: AiInput = { ...baseInput, text: 'Algo más' }
    const state: ConversationState = {
      ...baseState,
      flow: 'collecting_booking',
      turnCount: 10,
      maxTurns: 10,
    }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('reject')
    expect((decision as any).reason).toContain('varios intercambios')
  })
})

// ── Tests: No Services Guard ─────────────────────────────────────────────────

describe('DecisionEngine — Service Guards', () => {
  let engine: DecisionEngine

  beforeEach(() => {
    engine = new DecisionEngine()
  })

  it('[D12] No services configured → reject with setup guidance', () => {
    const input: AiInput = {
      ...baseInput,
      context: { ...baseInput.context, services: [] },
    }
    const state: ConversationState = { ...baseState }

    const decision = engine.analyze(input, state)

    expect(decision.type).toBe('reject')
    expect((decision as any).reason).toContain('No hay servicios')
  })

  it('[D13] Services undefined (loading) → allow through', () => {
    const input: AiInput = {
      ...baseInput,
      context: { ...baseInput.context, services: undefined },
      text: 'Quiero agendar',
    }
    const state: ConversationState = { ...baseState }

    const decision = engine.analyze(input, state)

    // Should proceed to LLM (not reject)
    expect(decision.type).toBe('reason_with_llm')
  })
})

// ── Tests: Confirmation Summary Builder ──────────────────────────────────────

describe('DecisionEngine — buildConfirmationSummary', () => {
  const services = [
    { id: 'svc-1', name: 'Corte', duration_min: 30, price: 15000 },
  ]

  it('[D14] Booking confirmation summary format', () => {
    const draft = {
      service_id: 'svc-1',
      client_name: 'Alan',
      date: '2026-04-25',
      time: '14:00',
    }

    const summary = buildConfirmationSummary('confirm_booking', draft, services)

    expect(summary).toContain('Vas a agendar')
    expect(summary).toContain('Corte')
    expect(summary).toContain('Alan')
    expect(summary).toContain('2026-04-25')
    expect(summary).toContain('14:00')
    expect(summary).toContain('¿Confirmas?')
  })

  it('[D15] Cancellation confirmation summary format', () => {
    const draft = {
      clientName: 'Alan',
      serviceName: 'Corte',
    }

    const summary = buildConfirmationSummary('cancel_booking', draft, services)

    expect(summary).toContain('Vas a cancelar')
    expect(summary).toContain('Alan')
    expect(summary).toContain('Corte')
  })

  it('[D16] Reschedule confirmation summary format', () => {
    const draft = {
      clientName: 'Alan',
      new_date: '2026-04-26',
      new_time: '15:00',
    }

    const summary = buildConfirmationSummary('reschedule_booking', draft, services)

    expect(summary).toContain('Vas a reagendar')
    expect(summary).toContain('Alan')
    expect(summary).toContain('2026-04-26')
    expect(summary).toContain('15:00')
  })
})
