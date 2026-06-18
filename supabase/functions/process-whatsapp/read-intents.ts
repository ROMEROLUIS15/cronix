/**
 * read-intents.ts — Deterministic read-only intents for the WhatsApp agent.
 *
 * "¿Tengo alguna cita?" used to produce a nonsensical echo because the agent has
 * no list-appointments capability. This answers it directly from the active
 * appointments already in context — 0 LLM tokens, no hallucination surface.
 */

type ActiveAppt = { service_name: string; start_at: string }

// Phrases that ask "do I have / show me my appointment(s)".
const LIST_APPTS_RE =
  /\b(?:tengo\s+(?:alguna\s+|una\s+)?cita|mis\s+citas|cu[áa]ndo\s+(?:es|tengo)\s+mi\s+cita|qu[ée]\s+citas\s+tengo|cita\s+(?:programada|agendada|pendiente|disponible)|ver\s+mis?\s+citas?|consultar\s+mis?\s+citas?)\b/i

// If the message also carries a write verb, it's a booking/cancel/reschedule
// flow — not a pure query — so we let the normal pipeline handle it.
const WRITE_VERB_RE = /\b(agend\w*|reserv\w*|cancel\w*|anul\w*|reagend\w*|reprogram\w*|mover|mueve)\b/i

export function isListAppointmentsQuery(text: string): boolean {
  if (WRITE_VERB_RE.test(text)) return false
  return LIST_APPTS_RE.test(text)
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
