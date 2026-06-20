/**
 * business-info.ts — Deterministic answers about the BUSINESS itself (location, hours).
 *
 * Anti-hallucination: "¿dónde están?" / "¿a qué hora abren?" used to fall to the LLM,
 * which could INVENT an address or a schedule. These build the reply straight from real
 * data (businesses.address + settings.workingHours) and, when the data is missing, say so
 * instead of guessing.
 */

import { formatLocalTime } from './prompt-builder.ts'
import type { WorkingHours } from './availability.ts'

type BusinessLite = { name: string; address: string | null }

/** Location reply from the real address, or an honest "I don't have it" — never invented. */
export function buildLocationResponse(business: BusinessLite): string {
  const addr = business.address?.trim()
  return addr
    ? `📍 *${business.name}* está en: ${addr}.\n\n¿Te ayudo a agendar una cita? 😊`
    : `Por aquí no tengo registrada la dirección de *${business.name}* 🙏. Te recomiendo confirmarla directamente con el negocio. ¿Te ayudo a agendar una cita?`
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_ES: Record<string, string> = {
  mon: 'lunes', tue: 'martes', wed: 'miércoles', thu: 'jueves', fri: 'viernes', sat: 'sábado', sun: 'domingo',
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Human business hours built from settings.workingHours, grouping consecutive equal days. */
export function buildHoursResponse(workingHours: WorkingHours, businessName: string): string {
  const configured = !!workingHours && Object.keys(workingHours).length > 0
  if (!configured) {
    return `En *${businessName}* atendemos de lunes a sábado, de 9:00 am a 6:00 pm. ¿Te ayudo a agendar una cita?`
  }

  // Group consecutive days (mon→sun) that share the same open/close (or are both closed).
  const groups: Array<{ days: string[]; sig: string; label: string }> = []
  for (const d of DAY_ORDER) {
    const v    = workingHours![d]
    const open = !!v && Array.isArray(v) && v.length >= 2
    const sig   = open ? `${v![0]}-${v![1]}` : 'closed'
    const label = open ? `de ${formatLocalTime(v![0])} a ${formatLocalTime(v![1])}` : 'cerrado'
    const last  = groups[groups.length - 1]
    if (last && last.sig === sig) last.days.push(DAY_ES[d]!)
    else groups.push({ days: [DAY_ES[d]!], sig, label })
  }

  const lines = groups.map((g) => {
    const days = g.days.length === 1 ? g.days[0]! : `${g.days[0]} a ${g.days[g.days.length - 1]}`
    return `• ${cap(days)}: ${g.label}`
  })
  return `🕒 En *${businessName}* atendemos:\n${lines.join('\n')}\n\n¿Te ayudo a agendar una cita?`
}
