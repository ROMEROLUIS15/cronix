/**
 * read-intents.ts — Deterministic read-only intents for the WhatsApp agent.
 *
 * "¿Tengo alguna cita?" used to produce a nonsensical echo because the agent has
 * no list-appointments capability. This answers it directly from the active
 * appointments already in context — 0 LLM tokens, no hallucination surface.
 */

import { isBookIntent, isManageExisting, isRescheduleIntent } from './intents.ts'

type ActiveAppt = { service_name: string; start_at: string }

// A message that carries a write verb (book/cancel/reschedule) is a flow, not a pure
// query, so the read layers defer to the booking pipeline. Reuses the canonical intent
// predicates (accent-insensitive) instead of a local regex that missed "agéndame".
function hasWriteVerb(text: string): boolean {
  return isBookIntent(text) || isManageExisting(text) || isRescheduleIntent(text)
}

// Phrases that ask "do I have / show me my appointment(s)". `citas?` matches both
// singular and plural; covers natural openers ("quiero saber si tengo citas…").
const LIST_APPTS_RE =
  /\b(?:tengo\s+(?:alguna\s+|una\s+|alguna\s+otra\s+)?citas?|mis\s+citas?|cu[áa]ndo\s+(?:es|tengo|ten[ií]a)\s+mi\s+cita|qu[ée]\s+citas?\s+tengo|cu[áa]les?\s+son\s+mis\s+citas?|saber\s+(?:si\s+)?(?:tengo\s+)?(?:mis\s+)?citas?|citas?\s+(?:programad|agendad|pendient|disponibl|activ)\w*|ver\s+mis?\s+citas?|consultar\s+mis?\s+citas?)\b/i

export function isListAppointmentsQuery(text: string): boolean {
  if (hasWriteVerb(text)) return false
  return LIST_APPTS_RE.test(text)
}

// "What services do you offer / how much does it cost" — a pure catalog question,
// answered deterministically (services + price) instead of the robotic booking-gather
// repeat or an LLM round-trip that could invent a price.
const SERVICES_QUERY_RE =
  /\b(qu[ée]\s+servicios?|qu[ée]\s+(?:ofrecen|ofreces)|servicios?\s+(?:tienen|ofrecen|hay|disponibles?)|lista\s+de\s+servicios?|cu[áa]nto\s+(?:cuesta|cuestan|vale|valen|sale|salen)|qu[ée]\s+precios?|los\s+precios?|las\s+tarifas?|qu[ée]\s+tarifas?)\b/i

export function isServicesQuery(text: string): boolean {
  return SERVICES_QUERY_RE.test(text)
}

// "What times are available (on X day)" as a standalone question — listed deterministically
// from real availability instead of letting the LLM invent slots. Runs AFTER the booking
// layer, so a mid-booking turn is handled by the state machine, not here.
const AVAILABILITY_QUERY_RE =
  /\b(qu[ée]\s+horarios?|horarios?\s+(?:hay|tienen|tienes|disponibles?|libres?)|qu[ée]\s+disponibilidad|hay\s+(?:cupo|espacio|disponibilidad)|tienes?\s+(?:algo\s+|cupo\s+|espacio\s+)?disponible|a\s+qu[ée]\s+horas?\s+(?:atienden|abren|atiendes)|qu[ée]\s+horas?\s+(?:hay|tienen|tienes))\b/i

export function isAvailabilityQuery(text: string): boolean {
  if (hasWriteVerb(text)) return false
  return AVAILABILITY_QUERY_RE.test(text)
}

// "Where are you / what's the address" — answered from the real address, never invented.
const LOCATION_QUERY_RE =
  /\b(d[óo]nde\s+(?:est[áa]n|queda|es|se\s+ubican|los?\s+encuentro)|direcci[óo]n|ubicaci[óo]n|ubicad[oa]s|c[óo]mo\s+(?:llego|llegar)|en\s+qu[ée]\s+(?:lugar|zona|parte|sitio))\b/i

export function isLocationQuery(text: string): boolean {
  return LOCATION_QUERY_RE.test(text)
}

// "What time / what days are you open" — the SCHEDULE (distinct from availability-for-booking,
// which asks for free slots on a date). Answered deterministically from working hours.
const HOURS_QUERY_RE =
  /\b(a\s+qu[ée]\s+hora\s+(?:abren|cierran|atienden|abres|cierras|atiendes)|hasta\s+qu[ée]\s+hora|qu[ée]\s+d[íi]as?\s+(?:abren|trabajan|atienden|laboran|abres|trabajas)|horario\s+de\s+atenci[óo]n|cu[áa]l\s+es\s+(?:su|el)\s+horario|est[áa]n\s+abiert[oa]s?|abren\s+(?:hoy|los|el|ma[ñn]ana)|trabajan\s+(?:hoy|los|el|ma[ñn]ana)|qu[ée]\s+horario)\b/i

export function isHoursQuery(text: string): boolean {
  if (hasWriteVerb(text)) return false
  return HOURS_QUERY_RE.test(text)
}

export function buildAppointmentsListResponse(
  appts:    ReadonlyArray<ActiveAppt>,
  timezone: string,
): string {
  if (appts.length === 0) {
    return 'No tienes ninguna cita activa por ahora. ¿Quieres que agendemos una? 😊'
  }
  const lines = appts.slice(0, 5).map((a) => {
    const dt   = new Date(a.start_at)
    const date = dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: timezone })
    const time = dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
    return `• *${a.service_name}* — ${date} a las ${time}`
  }).join('\n')
  const head = appts.length === 1 ? 'Tienes esta cita activa:' : `Tienes ${appts.length} citas activas:`
  return `${head}\n\n${lines}`
}
