/**
 * pipeline-integration.test.ts — End-to-end test of the ASSEMBLED agent pipeline.
 *
 * Unlike the unit tests (which exercise resolveBookingTurn / parsers in isolation), this
 * drives the real runAgentLoop with only the EXTERNAL boundaries mocked: the cold-start
 * singletons (memory recall, intent router, tracer, reviewer) and the LLM call. Everything
 * in between — buildTurnContext → [faq, list, services, booking, availability] → LLM
 * fallback — runs for real, so a regression in layer wiring/order is caught here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The edge-function graph references the Deno global + a Supabase client at load time;
// stub both so the real pipeline modules can be imported under Node/vitest.
vi.hoisted(() => {
  ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } }
})

vi.mock('../db-client.ts', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'insert', 'update', 'eq', 'maybeSingle', 'single', 'channel', 'send', 'order', 'limit'])
    chain[m] = () => chain
  ;(chain as { removeChannel: unknown }).removeChannel = async () => {}
  return { supabase: chain }
})

// Infra modules carry npm:/jsr: imports that vitest can't statically resolve. Stub them —
// they are exactly the boundaries (telemetry, hashing, DB adapter, cache) an integration
// test should fake; the real pipeline logic in between runs untouched.
vi.mock('../../_shared/sentry.ts', () => ({ addBreadcrumb: () => {}, captureException: () => {} }))
vi.mock('../../_shared/observability/index.ts', () => ({ shortHash: async () => 'hash', createTracer: () => ({ start: () => ({ recordToolCall() {}, recordLlmStep() {}, finish: async () => {} }) }) }))
vi.mock('../../_shared/supervisor/index.ts', () => ({ reviewWriteOrFailOpen: async () => ({ allowed: true }), createConstitutionalReviewer: () => null }))
vi.mock('../../_shared/cache-invalidation.ts', () => ({ invalidateDashboardCache: async () => {} }))
vi.mock('../../_shared/booking-adapter.ts', () => ({ WhatsAppBookingAdapter: class { execute() { return { success: false, error: 'MOCK' } } } }))

// Mutable router result so each test can steer intent classification.
const h = vi.hoisted(() => ({ intent: null as null | { intent: string; confidence: number } }))

vi.mock('../agent-singletons.ts', () => {
  const trace = { recordToolCall() {}, recordLlmStep() {}, finish: async () => {} }
  return {
    memoryEngine: { recall: async () => [], write: async () => {} },
    tracer:       { start: () => trace },
    router:       { classify: async () => h.intent },
    reviewer:     null,
  }
})

// Replace groq-client entirely (no importOriginal → don't load its Deno deps). The LLM
// fallback path uses callLlm; everything else is the real pipeline.
const llmReply = vi.hoisted(() => ({ content: 'Claro, con gusto te ayudo.' as string | null, tool_calls: null as unknown }))
vi.mock('../groq-client.ts', () => ({
  callLlm: async () => ({ response: { choices: [{ message: llmReply }] }, tokens: 42 }),
  SMALL_MODEL: 'mock-model',
  MAX_STEPS: 3,
  LlmRateLimitError: class LlmRateLimitError extends Error {},
  CircuitBreakerError: class CircuitBreakerError extends Error {},
}))

import { runAgentLoop } from '../ai-agent.ts'
import type { BusinessRagContext } from '../types.ts'

const OPEN_ALL = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'],
  thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: ['09:00', '18:00'], sun: ['09:00', '18:00'],
}

function ctx(over: Partial<BusinessRagContext> = {}): BusinessRagContext {
  return {
    business: { id: 'biz-1', name: 'IGM', timezone: 'America/Bogota', phone: '573000000000', address: 'Calle 5 #10-20', slug: 'igm',
      settings: { workingHours: OPEN_ALL } as unknown as BusinessRagContext['business']['settings'] },
    services: [{ id: 'svc-c', name: 'Corte', duration_min: 30, price: 25 }],
    client: { id: 'cli-1', name: 'Luis' },
    activeAppointments: [],
    history: [],
    bookedSlots: [],
    ...over,
  }
}

const run = (text: string, over?: Partial<BusinessRagContext>) => runAgentLoop(text, ctx(over), 'Luis', '573001112233')

describe('pipeline integration — deterministic layers (0 LLM tokens)', () => {
  beforeEach(() => { h.intent = null; llmReply.content = 'Claro, con gusto te ayudo.'; llmReply.tool_calls = null })

  it('FAQ greeting (router intent ≥0.90) → templated greeting, no LLM', async () => {
    h.intent = { intent: 'greeting', confidence: 0.97 }
    const r = await run('hola buenas')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/asistente virtual de \*IGM\*/i)
  })

  it('services query → catalog with price, no LLM', async () => {
    const r = await run('qué servicios tienen y cuánto cuestan')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/Corte/)
    expect(r.text).toMatch(/\$25/)
  })

  it('availability query → real slots for the day, no LLM', async () => {
    const r = await run('qué horarios hay el 25 de diciembre')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/25 de diciembre/)
    expect(r.text).toMatch(/9:00 am/)
  })

  it('location query → real address (never invented), no LLM', async () => {
    const r = await run('dónde están ubicados')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/Calle 5 #10-20/)
  })

  it('hours query → schedule from working hours, no LLM', async () => {
    const r = await run('a qué hora abren')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/9:00 am a 6:00 pm/)
  })

  it('list-appointments → lists the active appointment, no LLM', async () => {
    const r = await run('qué citas tengo', { activeAppointments: [
      { id: 'a1', service_name: 'Corte', start_at: '2026-12-25T14:00:00Z', end_at: '2026-12-25T14:30:00Z', status: 'confirmed' },
    ] })
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/Corte/)
    expect(r.text).toMatch(/cita activa/i)
  })

  it('specific-service pricing → answers just that service, no LLM', async () => {
    const r = await run('cuánto cuesta corte')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/\*Corte\* cuesta \$25 y dura 30 min/)
  })

  it('multi-intent "hola, quiero agendar" → defers to booking, not just a greeting', async () => {
    h.intent = { intent: 'greeting', confidence: 0.96 }
    const r = await run('hola, quiero agendar un corte')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/qué día y a qué hora/i)        // booking handled it
    expect(r.text).not.toMatch(/asistente virtual/i)       // not the greeting template
  })

  it('new booking intent → asks day/time deterministically, no LLM', async () => {
    const r = await run('quiero agendar un corte')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/qué día y a qué hora/i)
    expect(r.text).not.toMatch(/¿Confirmo/i) // never invents date/time
  })

  it('booking with full date+time → the ONLY source of a confirmation proposal', async () => {
    const r = await run('quiero agendar un corte el 25 de diciembre a las 10 am')
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/¿Confirmo tu cita de \*Corte\* para el 25 de diciembre a las 10:00 am/)
  })

  it('a completed booking does NOT hijack a later list query (layer ordering)', async () => {
    const r = await run('qué citas tengo', { history: [
      { role: 'user', text: 'quiero agendar' },
      { role: 'model', text: '✅ ¡Listo! Tu cita para *Corte* quedó agendada para el 25 de diciembre a las 10:00 am.' },
    ], activeAppointments: [
      { id: 'a1', service_name: 'Corte', start_at: '2026-12-25T15:00:00Z', end_at: '2026-12-25T15:30:00Z', status: 'confirmed' },
    ] })
    expect(r.tokens).toBe(0)
    expect(r.text).toMatch(/cita activa/i)        // list layer handled it
    expect(r.text).not.toMatch(/¿Confirmo/i)
  })
})

describe('pipeline integration — LLM fallback boundary', () => {
  beforeEach(() => { h.intent = null; llmReply.content = 'Claro, con gusto te ayudo.'; llmReply.tool_calls = null })

  it('an off-topic message with no deterministic match falls through to the LLM', async () => {
    const r = await run('cuéntame algo curioso del clima')
    expect(r.tokens).toBe(42)                      // the mocked LLM was actually called
    expect(r.text).toMatch(/con gusto te ayudo/i)
  })

  it('BLOCKS a hallucinated LLM booking proposal — the invented "¿Confirmo… a las…?" never reaches the client', async () => {
    llmReply.content = '¿Confirmo tu cita de *Corte* para el 25 de diciembre a las 3:00 pm?'
    const r = await run('algo que caiga al modelo')
    expect(r.text).not.toMatch(/¿Confirmo tu cita/i)        // the proposal was suppressed
    expect(r.text).toMatch(/necesito el servicio, el día y la hora/i) // safe deterministic re-gather
  })
})
