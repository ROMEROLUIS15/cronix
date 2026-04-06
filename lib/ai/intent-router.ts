/**
 * intent-router.ts — Zero-LLM fast path para intents de alta frecuencia.
 *
 * Detecta la intención del usuario por keywords normalizados ANTES de entrar
 * al ReAct loop. Si hay match con alta confianza → el tool se ejecuta directamente
 * sin gastar tokens en el LLM.
 *
 * Principio: el LLM es el sistema de razonamiento, no el default para todo.
 * Para queries de lectura simples y predecibles, esta capa ahorra ~50% de los tokens.
 *
 * REGLA: Solo agregar aquí intents READ de resultado determinista.
 * Nunca agregar WRITE intents (book, cancel, register) — esos siempre van al LLM
 * porque requieren confirmación de parámetros del usuario y razonamiento.
 */

import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchedIntent {
  toolName: string
  args?: Record<string, unknown>
}

export type RouterResult =
  | { matched: true;  intent: MatchedIntent }
  | { matched: false }

// ── Text normalization ─────────────────────────────────────────────────────────

/**
 * Normaliza el texto del usuario para un matching robusto:
 * - minúsculas
 * - sin acentos (maneja voz mal transcrita: "cuántas" → "cuantas")
 * - sin puntuación interrogativa/exclamativa
 * - espacios colapsados
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar diacríticos
    .replace(/[¿?¡!.,;:]/g, '')      // quitar puntuación
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Intent pattern table ───────────────────────────────────────────────────────
// Orden importa: más específico → más general.
// Cada entrada puede tener múltiples keywords; basta con que UNO haga match.

const INTENT_PATTERNS: Array<{
  toolName: string
  keywords: string[]
  args?: Record<string, unknown>
}> = [
  // ─ Resumen del día ──────────────────────────────────────────────────────────
  {
    toolName: 'get_today_summary',
    keywords: [
      'resumen de hoy',
      'resumen del dia',
      'como va el dia',
      'como vamos hoy',
      'cuantas citas hay hoy',
      'citas de hoy',
      'agenda de hoy',
      'que tenemos hoy',
      'reporte del dia',
      'balance del dia',
    ],
  },

  // ─ Huecos libres / disponibilidad ──────────────────────────────────────────
  {
    toolName: 'get_upcoming_gaps',
    keywords: [
      'hay espacio libre',
      'hay hueco',
      'cuando hay disponible',
      'horario disponible',
      'horario libre',
      'espacios libres',
      'proximos espacios',
      'cuando puedo agendar',
      'hay lugar hoy',
    ],
  },

  // ─ Ingresos / estadísticas semanales ────────────────────────────────────────
  {
    toolName: 'get_revenue_stats',
    keywords: [
      'cuanto facture',
      'cuanto gane',
      'ingresos de esta semana',
      'estadisticas de la semana',
      'ventas de esta semana',
      'como van los ingresos',
      'comparacion de semanas',
      'cuanto llevamos',
    ],
  },

  // ─ Catálogo de servicios ────────────────────────────────────────────────────
  {
    toolName: 'get_services',
    keywords: [
      'que servicios tienen',
      'que servicios ofrecen',
      'que hacen',
      'cuanto cuesta',
      'lista de servicios',
      'catalogo',
      'precios',
      'tratamientos disponibles',
      'que opciones hay',
    ],
  },

  // ─ Proyección mensual / forecast ────────────────────────────────────────────
  {
    toolName: 'get_monthly_forecast',
    keywords: [
      'proyeccion del mes',
      'cuanto vamos a cerrar',
      'cierre del mes',
      'estimado del mes',
      'cuanto falta para cerrar',
      'proyeccion mensual',
      'como va el mes',
    ],
  },

  // ─ Clientes inactivos ───────────────────────────────────────────────────────
  {
    toolName: 'get_inactive_clients',
    keywords: [
      'clientes inactivos',
      'quienes no han venido',
      'clientes que no vienen',
      'clientes perdidos',
      'quien falta',
      'clientes sin visita',
      'hace tiempo que no vienen',
    ],
  },
]

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Intenta resolver el intent del usuario sin llamar al LLM.
 *
 * @param userText  - Texto transcrito del usuario (STT output)
 * @param userId    - Para logging (opcional)
 * @returns RouterResult — si matched=true, el caller puede skip el ReAct loop
 */
export function routeIntent(userText: string, userId?: string): RouterResult {
  const normalized = norm(userText)

  // Guard: queries muy cortas son ambiguas — dejar al LLM razonar
  if (normalized.length < 8) {
    return { matched: false }
  }

  for (const pattern of INTENT_PATTERNS) {
    const hasMatch = pattern.keywords.some(kw => normalized.includes(norm(kw)))

    if (hasMatch) {
      logger.info('AI-ROUTER', `Static intent matched: ${pattern.toolName}`, {
        userId,
        query: normalized.slice(0, 60), // truncado para no loggear PII
      })
      return {
        matched: true,
        intent: {
          toolName: pattern.toolName,
          args:     pattern.args ?? {},
        },
      }
    }
  }

  return { matched: false }
}
