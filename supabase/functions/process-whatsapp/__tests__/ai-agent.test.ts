/**
 * ai-agent.test.ts — Tests for the AI Agent Fast Path (FAQ bypass).
 *
 * Validates that buildFaqResponse returns correct deterministic templates
 * for FAQ intents and does not fall through to the LLM path.
 *
 * runAgentLoop integration tests require full dependency mocking.
 * The pure helper buildFaqResponse is tested here in isolation.
 */

import { describe, it, expect } from 'vitest'
import { buildFaqResponse } from '../faq-responses.ts'
import type { BusinessRagContext } from '../types.ts'

const MOCK_CONTEXT: BusinessRagContext = {
  business: {
    id: 'biz-1',
    name: 'Barbería El Peluquero',
    timezone: 'America/Bogota',
    phone: null,
    settings: {},
    slug: 'barberia-el-peluquero',
  },
  services: [
    { id: 'svc-1', name: 'Corte de cabello', duration_min: 30, price: 15000 },
    { id: 'svc-2', name: 'Barba', duration_min: 15, price: 8000 },
  ],
  client: null,
  activeAppointments: [],
  history: [],
  bookedSlots: [],
}

describe('buildFaqResponse — greeting', () => {
  it('returns welcome template with business name', () => {
    const result = buildFaqResponse('greeting', MOCK_CONTEXT)
    expect(result).toContain('Barbería El Peluquero')
    expect(result).toContain('asistente virtual')
  })

  it('does not contain services list', () => {
    const result = buildFaqResponse('greeting', MOCK_CONTEXT)
    expect(result).not.toContain('Corte de cabello')
    expect(result).not.toContain('Barba')
  })
})

describe('buildFaqResponse — pricing_inquiry', () => {
  it('returns services list with prices', () => {
    const result = buildFaqResponse('pricing_inquiry', MOCK_CONTEXT)
    expect(result).toContain('Barbería El Peluquero')
    expect(result).toContain('Corte de cabello')
    expect(result).toContain('15000')
    expect(result).toContain('Barba')
    expect(result).toContain('8000')
  })

  it('returns fallback when no services configured', () => {
    const emptyCtx: BusinessRagContext = {
      ...MOCK_CONTEXT,
      services: [],
    }
    const result = buildFaqResponse('pricing_inquiry', emptyCtx)
    expect(result).toContain('Sin servicios configurados')
  })
})

describe('buildFaqResponse — unknown intent', () => {
  it('returns INTERNAL_SYNTAX_FALLBACK for unrecognized intent', () => {
    const result = buildFaqResponse('unknown_intent', MOCK_CONTEXT)
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })
})
