/**
 * final-response.ts — Final-pass response selector (pure, no I/O).
 *
 * Encodes the decision tree that picks the WhatsApp reply after the ReAct loop
 * completes:
 *  1. Tool succeeded → deterministic booking template (no second LLM call)
 *  2. Tool failed    → deterministic error by errorCode
 *  3. No loopText    → clarification fallback
 *  4. Otherwise      → 8B conversational response verbatim
 *
 * Extracted from ai-agent.ts:runAgentLoop so this branch logic can be
 * characterization-tested in isolation. The caller still owns sanitization
 * and the DB-driven deterministic fallback that runs after sanitization.
 */

import { renderBookingSuccessTemplate } from './prompt-builder.ts'

export function selectFinalResponse(
  actionPerformed: boolean,
  lastToolParsed:  Record<string, unknown> | null,
  loopText:        string,
  lastTrace:       { tool: string } | undefined,
  timezone:        string,
): string {
  if (actionPerformed && lastToolParsed?.success === true) {
    return renderBookingSuccessTemplate(
      lastTrace?.tool ?? '',
      lastToolParsed as Record<string, string>,
      timezone,
    )
  }

  if (actionPerformed && lastToolParsed?.success === false) {
    const errorCode = String(lastToolParsed?.error ?? '')
    if (errorCode.includes('SLOT_CONFLICT') || errorCode.includes('Slot no disponible')) {
      return '⚠️ Ese horario ya está ocupado. ¿Te gustaría intentar con otra fecha u hora disponible?'
    }
    if (errorCode.includes('BOOKING_RATE_LIMIT')) {
      return '⚠️ Has alcanzado el límite de citas nuevas por hoy. Por favor contáctanos directamente si necesitas agendar con urgencia.'
    }
    if (errorCode.includes('INVALID_ARGS')) {
      return '⚠️ Hubo un problema con los datos de la cita. Por favor indícame nuevamente el servicio, fecha y hora.'
    }
    if (errorCode.includes('UNAUTHORIZED') || errorCode.includes('NOT_FOUND')) {
      return '⚠️ No encontré esa cita en tu historial. ¿Puedes confirmarme los detalles?'
    }
    return '⚠️ No pude procesar tu solicitud en este momento. Por favor intenta de nuevo en unos minutos.'
  }

  if (!loopText) {
    return '¿Podrías indicarme con más detalle qué te gustaría hacer? Estoy aquí para ayudarte.'
  }

  return loopText
}
