/**
 * faq-responses.ts — Deterministic FAQ response templates for the WhatsApp Agent.
 *
 * These are extracted from ai-agent.ts so they can be tested in isolation
 * without triggering Deno dependency resolution (sentry, etc.).
 *
 * The FaqResponse type aligns with the return of runAgentLoop.
 */

import type { BusinessRagContext } from "./types.ts"

// ── FAQ Intents ────────────────────────────────────────────────────────────────
// Intents that can be answered with a pre-configured template, avoiding an
// LLM round-trip entirely. Extended by adding new intent labels here.

export const FAQ_INTENTS = new Set<string>([
  'greeting',
  'pricing_inquiry',
])

// ── Fallback ───────────────────────────────────────────────────────────────────

const INTERNAL_SYNTAX_FALLBACK = 'Estoy verificando la información. ¿Podrías confirmarme?'

/**
 * Builds a deterministic FAQ response for the given intent, using the
 * business context (name, services, hours) where needed.
 *
 * Precondition: `intent` must be one of `FAQ_INTENTS`.
 */
export function buildFaqResponse(
  intent:  string,
  context: BusinessRagContext,
): string {
  const { business, services } = context
  if (intent === 'greeting') {
    return `¡Hola! 👋 Soy el asistente virtual de *${business.name}*. Estoy aquí para ayudarte a agendar, reagendar o cancelar citas. ¿En qué puedo servirte?`
  }
  if (intent === 'pricing_inquiry') {
    const svcList = services.length > 0
      ? services.map(s => `• *${s.name}* — ${s.duration_min} min — $${s.price}`).join('\n')
      : '(Sin servicios configurados)'
    return `Aquí tienes los servicios de *${business.name}*:\n\n${svcList}\n\n¿Te gustaría agendar una cita?`
  }
  return INTERNAL_SYNTAX_FALLBACK
}
