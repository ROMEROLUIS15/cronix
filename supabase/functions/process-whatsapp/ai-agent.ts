/**
 * ai-agent.ts — Thin orchestrator for one WhatsApp turn.
 *
 * Builds the shared turn context, then dispatches through the deterministic pipeline
 * (FAQ → list-appointments → booking, each 0 LLM tokens); the first layer that resolves
 * the turn wins. If none do, it falls back to the ReAct LLM loop. All the real work lives
 * in focused modules — this file only wires them together (constitution §1.0).
 *
 * Module map:
 *  - turn-context.ts       → buildTurnContext (history, memory, intent, guard, tracer)
 *  - pipeline.ts           → layerFaq / layerListAppointments / layerBooking
 *  - deterministic-write.ts→ executeDeterministicWrite (0-token write path)
 *  - react-loop.ts         → runReActLlm (LLM fallback + deterministic final pass)
 *  - transcription.ts      → transcribeAudio (Deepgram STT)
 *  - output-sanitizer.ts   → client-output guards + PII scrub
 */

import type { BusinessRagContext } from "./types.ts"
import { LlmRateLimitError, CircuitBreakerError } from "./groq-client.ts"
import { buildTurnContext, type TurnResult } from "./turn-context.ts"
import { layerFaq, layerListAppointments, layerBooking } from "./pipeline.ts"
import { runReActLlm } from "./react-loop.ts"
import { transcribeAudio } from "./transcription.ts"

export { LlmRateLimitError, CircuitBreakerError, transcribeAudio }

/**
 * Runs one WhatsApp turn. The deterministic pipeline is tried first (0 LLM tokens); a
 * READ query ("¿tengo citas?") is matched before the booking WRITE path so it's never
 * hijacked by a sticky booking context (safe: isListAppointmentsQuery excludes any
 * message carrying a write verb). If no layer resolves the turn, the ReAct LLM loop runs.
 *
 * @param userText     - Sanitized message text from the customer
 * @param context      - Full BusinessRagContext (services, history, booked slots, etc.)
 * @param customerName - Display name from WhatsApp
 * @param sender       - WhatsApp phone number (used for booking payload)
 */
export async function runAgentLoop(
  userText:     string,
  context:      BusinessRagContext,
  customerName: string,
  sender:       string,
): Promise<TurnResult> {
  const tc = await buildTurnContext(userText, context, customerName, sender)

  for (const layer of [layerFaq, layerListAppointments, layerBooking]) {
    const result = await layer(tc)
    if (result) return result
  }

  return await runReActLlm(tc)
}
