/**
 * availability-query.ts — Deterministic answer to a standalone "¿qué horarios hay…?".
 *
 * Lists REAL free slots for a parsed day instead of letting the LLM invent times. Needs a
 * service for the slot duration: with a single service it lists directly; with several it
 * asks which (nudging into the booking flow). Runs only outside booking context.
 */

import { parseDateExpression } from './date-parser.ts'
import { computeAvailableSlots, todayInTimezone, type WorkingHours, type BookedSlot } from './availability.ts'
import { type ServiceLite, humanDate, listFreeTimes } from './booking-shared.ts'

export function resolveAvailabilityQuery(p: {
  userText:     string
  services:     ReadonlyArray<ServiceLite>
  workingHours: WorkingHours
  timezone:     string
  bookedSlots:  ReadonlyArray<BookedSlot>
}): string {
  const { userText, services, workingHours, timezone, bookedSlots } = p

  const parsed = parseDateExpression(userText, todayInTimezone(timezone), 'future')
  if (!parsed) {
    return '¿Para qué día quieres ver la disponibilidad? Por ejemplo *mañana*, *el 21* o *el lunes*.'
  }
  const when = humanDate(parsed.date)

  // Slot length depends on the service. Without a single obvious one, ask which.
  if (services.length !== 1) {
    const names = services.map((s) => s.name).join(', ')
    return names
      ? `¿Para qué servicio quieres ver los horarios del ${when}? Tenemos: ${names}.`
      : `¿Para qué servicio quieres ver los horarios del ${when}?`
  }

  const svc = services[0]!
  const { open, slots } = computeAvailableSlots({ workingHours, date: parsed.date, timezone, durationMin: svc.duration_min, bookedSlots })
  if (!open)            return `El ${when} estamos cerrados. ¿Quieres ver otro día?`
  if (slots.length === 0) return `Para el ${when} no me queda ningún horario libre para *${svc.name}*. ¿Probamos con otro día?`
  return `Para el ${when} tengo estos horarios libres para *${svc.name}*: ${listFreeTimes(slots)}. ¿Te agendo alguno? 😊`
}
