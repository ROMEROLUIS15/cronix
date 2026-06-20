/**
 * deterministic-intent.ts — DB-driven fallback when the 8B yields empty/unusable output.
 *
 * Used ONLY when the LLM produced nothing usable while the gate is blocked. Builds the
 * clarification/confirmation question directly from DB state so the client always gets a
 * specific, correct answer (cancel/reschedule details, or the next booking question)
 * even if the model fails — instead of looping on the generic "Estoy verificando…".
 */

import type { ActiveAppointmentRow } from "./types.ts"
import { isCancelIntent, isRescheduleIntent, isBookIntent } from "./intents.ts"

function formatApt(apt: ActiveAppointmentRow, timezone: string): { dateStr: string; timeStr: string } {
  const dt      = new Date(apt.start_at)
  const dateStr = dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: timezone })
  const timeStr = dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
  return { dateStr, timeStr }
}

export function buildDeterministicIntentResponse(
  userText:           string,
  activeAppointments: ActiveAppointmentRow[],
  timezone:           string,
  services:           ReadonlyArray<{ name: string }> = [],
): string | null {
  const cancelIntent     = isCancelIntent(userText)
  const rescheduleIntent = isRescheduleIntent(userText)

  // Booking intent recovery: when the 8B failed to produce a usable reply for a
  // booking turn, ask for the missing data deterministically instead of looping
  // on the "Estoy verificando la información" fallback.
  if (!cancelIntent && !rescheduleIntent && isBookIntent(userText)) {
    if (services.length === 1) {
      return `Con gusto te agendo *${services[0]!.name}*. ¿Para qué día y a qué hora te gustaría?`
    }
    return 'Con gusto te ayudo a agendar. ¿Qué servicio te gustaría y para qué día?'
  }

  if (!cancelIntent && !rescheduleIntent) return null

  if (activeAppointments.length === 0) {
    return 'No veo ninguna cita activa a tu nombre. ¿Quieres agendar una nueva?'
  }

  if (activeAppointments.length === 1) {
    const apt = activeAppointments[0]!
    const { dateStr, timeStr } = formatApt(apt, timezone)
    if (cancelIntent) {
      return `¿Confirmas que cancele tu cita de *${apt.service_name}* del ${dateStr} a las ${timeStr}?`
    }
    return `¿Para qué nueva fecha y hora te gustaría reagendar tu cita de *${apt.service_name}* del ${dateStr} a las ${timeStr}?`
  }

  const list = activeAppointments.slice(0, 5).map((apt, i) => {
    const { dateStr, timeStr } = formatApt(apt, timezone)
    return `${i + 1}. *${apt.service_name}* — ${dateStr} a las ${timeStr}`
  }).join('\n')

  const verb = cancelIntent ? 'cancelar' : 'reagendar'
  return `Tienes varias citas activas:\n\n${list}\n\n¿Cuál de ellas quieres ${verb}?`
}
