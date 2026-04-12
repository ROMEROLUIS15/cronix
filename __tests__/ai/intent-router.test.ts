/**
 * intent-router.test.ts — Unit tests for zero-LLM intent routing.
 *
 * Every keyword pattern must have at least:
 *  1. A test that triggers the correct tool routing.
 *  2. A test that does NOT trigger a false match.
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
    expect((result as any).intent.toolName).toBe(expectedTool)
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

// ── get_today_summary ────────────────────────────────────────────────────────
describe('routeIntent — get_today_summary', () => {
  assertMatch('¿Cuál es el resumen de hoy?', 'get_today_summary')
  assertMatch('Resumen del dia por favor', 'get_today_summary')
  assertMatch('¿Cómo va el día?', 'get_today_summary')
  assertMatch('¿Cuántas citas hay hoy?', 'get_today_summary')
  assertMatch('Citas de hoy', 'get_today_summary')
  assertMatch('Muéstrame la agenda de hoy', 'get_today_summary')
  assertMatch('¿Qué tenemos hoy?', 'get_today_summary')
  assertMatch('Reporte del dia', 'get_today_summary')
  assertMatch('Balance del día', 'get_today_summary')
  assertMatch('Como vamos hoy con las citas', 'get_today_summary')
})

// ── get_upcoming_gaps ───────────────────────────────────────────────────────
describe('routeIntent — get_upcoming_gaps', () => {
  assertMatch('¿Hay espacio libre hoy?', 'get_upcoming_gaps')
  assertMatch('¿Hay hueco para más citas?', 'get_upcoming_gaps')
  assertMatch('¿Cuándo hay disponible?', 'get_upcoming_gaps')
  assertMatch('Horario disponible por favor', 'get_upcoming_gaps')
  assertMatch('Espacios libres', 'get_upcoming_gaps')
  assertMatch('Próximos espacios', 'get_upcoming_gaps')
  assertMatch('¿Cuándo puedo agendar?', 'get_upcoming_gaps')
  assertMatch('¿Hay lugar hoy?', 'get_upcoming_gaps')
})

// ── get_revenue_stats ───────────────────────────────────────────────────────
describe('routeIntent — get_revenue_stats', () => {
  assertMatch('¿Cuánto facturé esta semana?', 'get_revenue_stats')
  assertMatch('¿Cuánto gané?', 'get_revenue_stats')
  assertMatch('Ingresos de esta semana', 'get_revenue_stats')
  assertMatch('Estadísticas de la semana', 'get_revenue_stats')
  assertMatch('Ventas de esta semana', 'get_revenue_stats')
  assertMatch('¿Cómo van los ingresos?', 'get_revenue_stats')
  assertMatch('Comparación de semanas', 'get_revenue_stats')
  assertMatch('¿Cuánto llevamos?', 'get_revenue_stats')
})

// ── get_services ─────────────────────────────────────────────────────────────
describe('routeIntent — get_services', () => {
  assertMatch('¿Qué servicios tienen?', 'get_services')
  assertMatch('¿Qué servicios ofrecen?', 'get_services')
  assertMatch('¿Qué hacen aquí?', 'get_services')
  assertMatch('¿Cuánto cuesta?', 'get_services')
  assertMatch('Lista de servicios', 'get_services')
  assertMatch('Catálogo', 'get_services')
  assertMatch('Precios por favor', 'get_services')
  assertMatch('Tratamientos disponibles', 'get_services')
  assertMatch('¿Qué opciones hay?', 'get_services')
})

// ── get_monthly_forecast ─────────────────────────────────────────────────────
describe('routeIntent — get_monthly_forecast', () => {
  assertMatch('Proyección del mes', 'get_monthly_forecast')
  assertMatch('¿Cuánto vamos a cerrar?', 'get_monthly_forecast')
  assertMatch('Cierre del mes por favor', 'get_monthly_forecast')
  assertMatch('Estimado del mes', 'get_monthly_forecast')
  assertMatch('¿Cuánto falta para cerrar el mes?', 'get_monthly_forecast')
  assertMatch('Proyección mensual', 'get_monthly_forecast')
  assertMatch('¿Cómo va el mes?', 'get_monthly_forecast')
})

// ── get_inactive_clients ─────────────────────────────────────────────────────
describe('routeIntent — get_inactive_clients', () => {
  assertMatch('Clientes inactivos', 'get_inactive_clients')
  assertMatch('¿Quiénes no han venido?', 'get_inactive_clients')
  assertMatch('Clientes que no vienen', 'get_inactive_clients')
  assertMatch('Clientes perdidos', 'get_inactive_clients')
  assertMatch('¿Quién falta?', 'get_inactive_clients')
  assertMatch('Clientes sin visita', 'get_inactive_clients')
  assertMatch('Hace tiempo que no vienen', 'get_inactive_clients')
})

// ── False Positive Prevention ────────────────────────────────────────────────
describe('routeIntent — no false positives', () => {
  // WRITE intents should NEVER be auto-routed
  assertNoMatch('Agenda una cita con María')
  assertNoMatch('Cancela la cita de hoy')
  assertNoMatch('Reagenda para mañana')
  assertNoMatch('Registra un pago de 50 dólares')
  assertNoMatch('Crea un cliente nuevo')
  assertNoMatch('Envía WhatsApp a Juan')

  // Ambiguous queries — let LLM reason
  assertNoMatch('Necesito ayuda')
  assertNoMatch('Hola, ¿cómo estás?')
  assertNoMatch('Quiero saber sobre las citas de María')
  assertNoMatch('¿Quién es el mejor cliente?')
  assertNoMatch('Gracias por todo')
})

// ── Accent/Normalization Robustness ──────────────────────────────────────────
describe('routeIntent — normalization edge cases', () => {
  assertMatch('RESUMEN DE HOY!!!', 'get_today_summary')       // uppercase + punctuation
  assertMatch('¿¿cuanto facture??', 'get_revenue_stats')      // double punctuation
  assertMatch('  espacios   libres  ', 'get_upcoming_gaps')   // extra whitespace
  assertMatch('catalogo de servícios', 'get_services')        // accent variation
  assertMatch('Clientes ináctivos', 'get_inactive_clients')   // accent
})
