/**
 * intent-router.test.ts — Unit tests for zero-LLM intent routing.
 *
 * NOTE: Many patterns were removed in the voice-agent rewrite because their
 *   tools were never registered in RealToolExecutor (get_today_summary,
 *   get_upcoming_gaps, get_revenue_stats, get_monthly_forecast, get_inactive_clients).
 *   When those tools get implemented, re-add their patterns + tests.
 *
 * The intent-router itself is currently bypassed by the new voice-agent
 * (lib/ai/voice-agent.ts) which uses Vercel AI SDK native tool calling.
 * These tests remain as a guard for the patterns that DO still exist, in case
 * a future fast-path optimization wires routeIntent back in.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock logger (routeIntent calls logger.info)
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { routeIntent } from '@/lib/ai/intent-router'

// ── Helpers ──────────────────────────────────────────────────────────────────
function assertMatch(text: string, expectedTool: string) {
  it(`matches "${text.slice(0, 40)}" → ${expectedTool}`, () => {
    const result = routeIntent(text)
    expect(result.matched).toBe(true)
    expect((result as { matched: true; intent: { toolName: string } }).intent.toolName).toBe(expectedTool)
  })
}

function assertNoMatch(text: string) {
  it(`no match: "${text.slice(0, 40)}"`, () => {
    const result = routeIntent(text)
    expect(result.matched).toBe(false)
  })
}

// ── Guard Clauses ────────────────────────────────────────────────────────────
describe('routeIntent — guards', () => {
  assertNoMatch('hola')       // too short
  assertNoMatch('si')         // too short
  assertNoMatch('')           // empty
  assertNoMatch('  ')         // whitespace
  assertNoMatch('?')          // punctuation only
})

// ── get_appointments_by_date — "mañana" pattern ──────────────────────────────
describe('routeIntent — get_appointments_by_date (mañana)', () => {
  assertMatch('citas de mañana',          'get_appointments_by_date')
  assertMatch('agenda de mañana',         'get_appointments_by_date')
  assertMatch('¿qué tengo mañana?',       'get_appointments_by_date')
  assertMatch('citas para mañana',        'get_appointments_by_date')
  assertMatch('quien viene mañana',       'get_appointments_by_date')
})

// ── get_appointments_by_date — numeric date pattern ──────────────────────────
describe('routeIntent — get_appointments_by_date (numeric date)', () => {
  // The router resolves "el día 16" / "del día 5" / "el 5 de mayo" → ISO date
  it('matches "citas del día 16"', () => {
    const result = routeIntent('citas del día 16')
    expect(result.matched).toBe(true)
    expect((result as { matched: true; intent: { toolName: string } }).intent.toolName).toBe('get_appointments_by_date')
  })
})

// ── get_services ─────────────────────────────────────────────────────────────
describe('routeIntent — get_services', () => {
  assertMatch('¿Qué servicios tienen?',   'get_services')
  assertMatch('¿Qué servicios ofrecen?',  'get_services')
  assertMatch('Lista de servicios',       'get_services')
  assertMatch('Catálogo',                 'get_services')
  assertMatch('Precios por favor',        'get_services')
  assertMatch('Tratamientos disponibles', 'get_services')
})

// ── False Positive Prevention ────────────────────────────────────────────────
describe('routeIntent — no false positives', () => {
  // WRITE intents must NEVER be auto-routed
  assertNoMatch('Agenda una cita con María')
  assertNoMatch('Cancela la cita de hoy')
  assertNoMatch('Reagenda para mañana')
  assertNoMatch('Registra un pago de 50 dólares')
  assertNoMatch('Crea un cliente nuevo')

  // Ambiguous / conversational queries
  assertNoMatch('Necesito ayuda')
  assertNoMatch('Hola, ¿cómo estás?')
  assertNoMatch('Quiero saber sobre las citas de María')
  assertNoMatch('¿Quién es el mejor cliente?')

  // Specific person mentions — must go to LLM for entity resolution
  assertNoMatch('un cliente llamado Luis Romero')
  assertNoMatch('busca al cliente llamado Pedro')
  assertNoMatch('el cliente Juan tiene cita')

  // Removed patterns — should now fall through (let LLM handle them)
  assertNoMatch('Resumen del día')
  assertNoMatch('Clientes inactivos')
  assertNoMatch('¿Cuánto facturé?')
  assertNoMatch('Proyección del mes')
  assertNoMatch('Espacios libres')
})

// ── Accent/Normalization Robustness ──────────────────────────────────────────
describe('routeIntent — normalization edge cases', () => {
  assertMatch('CATALOGO DE SERVICIOS!!!', 'get_services')          // uppercase + punctuation
  assertMatch('  citas   de   mañana  ', 'get_appointments_by_date') // extra whitespace
  assertMatch('catalogo de servícios',   'get_services')           // accent variation
})
