/**
 * conversation-evals.test.ts — E2E golden CONVERSATION evals for the WhatsApp agent.
 *
 * Unlike unit tests (component logic) and pipeline-integration (single turns), this drives
 * the REAL runAgentLoop across MULTI-TURN conversations — threading the agent's own replies
 * back as history, exactly like production — and checks the deterministic behaviour turn by
 * turn. The LLM/DB/infra boundaries are mocked (the adapter returns success so the write path
 * is exercised end-to-end), so it is deterministic + fast + BLOCKING in CI (runs in the
 * vitest `unit` job). It locks every flow hardened this session against regression.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BusinessRagContext, ChatHistoryItem } from '../types.ts'

vi.hoisted(() => { (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } } })

vi.mock('../db-client.ts', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'insert', 'update', 'eq', 'maybeSingle', 'single', 'channel', 'send', 'order', 'limit', 'in', 'not', 'gte', 'lte'])
    chain[m] = () => chain
  ;(chain as { removeChannel: unknown }).removeChannel = async () => {}
  return { supabase: chain }
})

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
vi.mock('../groq-client.ts', () => ({
  callLlm: async () => ({ response: { choices: [{ message: { content: 'Claro 😊', tool_calls: null } }] }, tokens: 7 }),
  SMALL_MODEL: 'mock', MAX_STEPS: 3,
  LlmRateLimitError: class extends Error {}, CircuitBreakerError: class extends Error {},
}))
vi.mock('../guards.ts', () => ({
  checkBookingRateLimit: async () => true, checkCircuitBreaker: async () => true,
  reportServiceFailure: async () => {}, reportServiceSuccess: async () => {}, trackTokenUsage: async () => {},
}))
vi.mock('../../_shared/sentry.ts', () => ({ addBreadcrumb: () => {}, captureException: () => {} }))
vi.mock('../../_shared/observability/index.ts', () => ({ shortHash: async () => 'hash', createTracer: () => ({ start: () => ({ recordToolCall() {}, recordLlmStep() {}, finish: async () => {} }) }) }))
vi.mock('../../_shared/supervisor/index.ts', () => ({ reviewWriteOrFailOpen: async () => ({ allowed: true }), createConstitutionalReviewer: () => null }))
vi.mock('../../_shared/cache-invalidation.ts', () => ({ invalidateDashboardCache: async () => {} }))
// Adapter returns SUCCESS so propose→sí→write renders the real success template.
vi.mock('../../_shared/booking-adapter.ts', () => ({
  WhatsAppBookingAdapter: class {
    execute(p: { rawArgs?: Record<string, string>; services?: Array<{ id: string; name: string }> }) {
      const a = p.rawArgs ?? {}
      const svc = (p.services ?? []).find((s) => s.id === a['service_id'])
      return { success: true, appointmentId: 'apt-eval', serviceName: svc?.name ?? 'Servicio', date: a['new_date'] ?? a['date'], time: a['new_time'] ?? a['time'] }
    }
  },
}))

import { runAgentLoop } from '../ai-agent.ts'

const WH = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'],
  thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: ['09:00', '18:00'], sun: null,
}
const SERVICES = [
  { id: 'svc-t', name: 'Tarjeta', duration_min: 30, price: 45 },
  { id: 'svc-e', name: 'Electrónica', duration_min: 120, price: 80 },
  { id: 'svc-m', name: 'Mantenimiento', duration_min: 120, price: 60 },
]
function baseCtx(over: Partial<BusinessRagContext> = {}): BusinessRagContext {
  return {
    business: { id: 'biz-1', name: 'IGM', timezone: 'America/Caracas', phone: '584140000000', address: 'Av. Bolívar, local 5', slug: 'igm',
      settings: { workingHours: WH } as unknown as BusinessRagContext['business']['settings'] },
    services: SERVICES, client: { id: 'cli-1', name: 'Luis' },
    activeAppointments: [], history: [], bookedSlots: [], ...over,
  }
}

type Turn = { user: string; intent?: { intent: string; confidence: number } | null; expect?: RegExp[]; notExpect?: RegExp[] }

/** Drives a full conversation through runAgentLoop, threading the agent's replies as history. */
async function runConversation(ctxOver: Partial<BusinessRagContext>, turns: Turn[]) {
  const history: ChatHistoryItem[] = []
  for (const turn of turns) {
    h.intent = turn.intent ?? null
    const r = await runAgentLoop(turn.user, baseCtx({ ...ctxOver, history: [...history] }), 'Luis', '584241112233')
    for (const re of turn.expect ?? [])    expect(r.text, `turn "${turn.user}" → ${r.text}`).toMatch(re)
    for (const re of turn.notExpect ?? []) expect(r.text, `turn "${turn.user}" → ${r.text}`).not.toMatch(re)
    // Global invariant: internal syntax never leaks to the client.
    expect(r.text).not.toMatch(/<function|"service_id"|confirm_booking\s*\(|REF#/i)
    history.push({ role: 'user', text: turn.user }, { role: 'model', text: r.text })
  }
}

const APPT_FRI = { id: 'apt-1', service_name: 'Mantenimiento', start_at: '2026-12-25T19:00:00Z', end_at: '2026-12-25T21:00:00Z', status: 'confirmed' } // 15:00 Caracas, Fri

beforeEach(() => { h.intent = null })

describe('conversation evals — golden flows (E2E, deterministic)', () => {
  it('happy booking: service → date+time → confirm → booked', async () => {
    await runConversation({}, [
      { user: 'hola', intent: { intent: 'greeting', confidence: 0.97 }, expect: [/asistente virtual de \*IGM\*/i] },
      { user: 'quiero agendar tarjeta',            expect: [/qué día y a qué hora/i], notExpect: [/¿Confirmo/i] },
      { user: 'el 25 de diciembre a las 10 am',    expect: [/¿Confirmo tu cita de \*Tarjeta\* para el 25 de diciembre a las 10:00 am/] },
      { user: 'sí',                                expect: [/(qued[oó] agendada|Listo)/i] },
    ])
  })

  it('service recognition (no accent) + ambiguous hour 1–7 → PM', async () => {
    await runConversation({}, [
      { user: 'quiero agendar',                    expect: [/Qué servicio deseas/i] },
      { user: 'electronica',                       expect: [/Electrónica/], notExpect: [/Qué servicio deseas/i] },
      { user: 'el 25 de diciembre a las 5',        expect: [/Electrónica.*5:00 pm|5:00 pm.*Electrónica/i] }, // 5 → 17:00, not 5am
    ])
  })

  it('reschedule: closed Sunday keeps context + suggests + executes on confirm', async () => {
    await runConversation({ activeAppointments: [APPT_FRI] }, [
      { user: 'necesito reagendar mi cita',        expect: [/nueva fecha quieres reagendar/i, /Mantenimiento/] },
      { user: 'para el 27 de diciembre',           expect: [/no abre|cerrad/i, /reagendamos/i, /lunes 28 de diciembre/i], notExpect: [/Qué servicio deseas/i] },
      { user: 'para el 28 de diciembre',           expect: [/a qué hora/i, /reagendar/i] },
      { user: 'a la misma hora',                   expect: [/¿Reagendo tu cita de \*Mantenimiento\* del 25 de diciembre al 28 de diciembre a las 3:00 pm/] },
      { user: 'sí',                                expect: [/reagendada|Listo/i] },
    ])
  })

  it('business info: location + hours from real data (never invented)', async () => {
    await runConversation({}, [
      { user: 'dónde están ubicados',              expect: [/Av\. Bolívar, local 5/] },
      { user: 'a qué hora abren',                  expect: [/Lunes a sábado: de 9:00 am a 6:00 pm/, /Domingo: cerrado/] },
      { user: 'cuánto cuesta tarjeta',             expect: [/\*Tarjeta\* cuesta \$45/] },
    ])
  })

  it('past date is rejected with a clear message', async () => {
    await runConversation({}, [
      { user: 'quiero agendar tarjeta',            expect: [/qué día/i] },
      { user: 'ayer',                              expect: [/ya pasó/i], notExpect: [/No te entend/i] },
    ])
  })

  it('multi-intent greeting+booking defers to booking', async () => {
    await runConversation({}, [
      { user: 'hola, quiero agendar un mantenimiento', intent: { intent: 'greeting', confidence: 0.96 },
        expect: [/qué día y a qué hora/i], notExpect: [/asistente virtual/i] },
    ])
  })

  it('cancel: identifies the appointment and executes on confirm', async () => {
    await runConversation({ activeAppointments: [APPT_FRI] }, [
      { user: 'quiero cancelar mi cita',           expect: [/cancele tu cita de \*Mantenimiento\*/i] },
      { user: 'sí',                                expect: [/cancelada|Listo/i] },
    ])
  })
})
