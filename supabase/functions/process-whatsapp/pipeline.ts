/**
 * pipeline.ts — Deterministic per-turn layers (each: a TurnResult, or null to pass on).
 *
 * The orchestrator runs these in order before falling back to the LLM. Each layer is a
 * single responsibility and costs 0 LLM tokens: FAQ fast-path, the booking state machine
 * (anti-hallucination write path), and the list-appointments read.
 */

import { addBreadcrumb } from "../_shared/sentry.ts"
import { resolveBookingTurn } from "./booking-flow.ts"
import type { WorkingHours } from "./availability.ts"
import { isListAppointmentsQuery, buildAppointmentsListResponse } from "./read-intents.ts"
import { FAQ_INTENTS, buildFaqResponse } from "./faq-responses.ts"
import { executeDeterministicWrite } from "./deterministic-write.ts"
import { BOOKING_PROPOSAL_DETECT_RE } from "./output-sanitizer.ts"
import type { TurnContext, TurnResult } from "./turn-context.ts"

/** FAQ fast-path: high-confidence info/greeting intents bypass the LLM entirely. */
export async function layerFaq(tc: TurnContext): Promise<TurnResult | null> {
  const { intent, context } = tc
  if (!(intent && intent.confidence >= 0.90 && FAQ_INTENTS.has(intent.intent))) return null
  const text = buildFaqResponse(intent.intent, context)
  await tc.quickTrace(text, 'faq', { intent: intent.intent })
  return { text, tokens: 0, toolCallsTrace: [] }
}

/** Deterministic booking state machine (anti-hallucination WRITE path). */
export async function layerBooking(tc: TurnContext): Promise<TurnResult | null> {
  const { userText, context, customerName, sender, business, cappedHistory, intent, memoryScope } = tc
  const bookingTurn = resolveBookingTurn({
    userText,
    history:      cappedHistory,
    services:     context.services.map(s => ({ id: s.id, name: s.name, duration_min: s.duration_min })),
    workingHours: (business.settings as { workingHours?: unknown } | null | undefined)?.workingHours as WorkingHours,
    timezone:     business.timezone,
    bookedSlots:  (context.bookedSlots ?? []).map(s => ({ start_at: s.start_at, end_at: s.end_at })),
    activeAppointments: context.activeAppointments.map(a => ({ id: a.id, service_name: a.service_name, start_at: a.start_at })),
    intent:       intent?.intent ?? null,
  })
  if (bookingTurn?.kind === 'reply') {
    addBreadcrumb('Deterministic booking/cancel/reschedule proposal (0 tokens)', 'agent', 'info', { intent: intent?.intent ?? 'unknown' })
    await tc.quickTrace(bookingTurn.text, 'deterministic_booking', {
      isProposal: BOOKING_PROPOSAL_DETECT_RE.test(bookingTurn.text),
      intent: intent?.intent ?? null,
    })
    return { text: bookingTurn.text, tokens: 0, toolCallsTrace: [] }
  }
  if (bookingTurn) {
    // narrowed to an execute directive (the reply case returned above)
    return await executeDeterministicWrite(bookingTurn, context, sender, customerName, memoryScope, userText)
  }
  return null
}

/** Deterministic read: "¿tengo alguna cita?" answered from active appointments. */
export async function layerListAppointments(tc: TurnContext): Promise<TurnResult | null> {
  const { userText, context, business } = tc
  if (!isListAppointmentsQuery(userText)) return null
  const text = buildAppointmentsListResponse(context.activeAppointments, business.timezone)
  addBreadcrumb('Deterministic list-appointments resolved (0 tokens)', 'agent', 'info', { count: context.activeAppointments.length })
  await tc.quickTrace(text, 'deterministic_list', { count: context.activeAppointments.length })
  return { text, tokens: 0, toolCallsTrace: [] }
}
