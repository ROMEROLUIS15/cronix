/**
 * Fast path for "qué citas tiene <cliente>" / "citas de <cliente>" /
 * "cuándo viene <cliente>" / "próxima cita de <cliente>".
 *
 * Fills the read-capability gap the LLM used to hallucinate around: there
 * was no tool that lists a specific client's upcoming appointments, so the
 * model answered from the prompt's 5-row "CITAS DE HOY" excerpt or invented.
 *
 * Read-only — never matches when a write verb is present ("reagenda la cita
 * de Ana" must reach reschedule). Captured names that are really date words
 * ("citas de mañana") are rejected so list-appointments / LLM handle them.
 */

import { parseDateExpression } from '../../core/date-parser.ts'
import { normalize, tokens }   from '../../core/fuzzy.ts'
import type { CatalogService } from '../_shared/Capability.ts'

export interface ClientAppointmentsArgs extends Record<string, unknown> {
  client_name: string
}

const WRITE = /\b(ag[eé]?nd\w*|reagend\w*|reprogram\w*|cancel\w*|borr\w*|elimin\w*|registr\w*|cre[aoeé]\w*|anad\w*|añad\w*|agreg\w*|muev\w*|cambi\w*)\b/

// "última cita de Ana" is last-visit's intent (past attended), not upcoming.
const PAST_INTENT = /\b(ultim[ao]s?|anterior(?:es)?|pasad[ao]s?)\b/

/** Time-of-day / calendar words that disqualify a captured "name". */
const DATE_WORDS = /\b(hoy|ma[ñn]ana|pasado|ayer|semana|mes|a[ñn]o|lunes|martes|mi[eé]rcoles|miercoles|jueves|viernes|s[aá]bado|sabado|domingo|tarde|noche|madrugada|mediod[ií]a|fin)\b/

const NAME = String.raw`([a-z][a-z\s.'-]{1,60}?)`
const TAIL = String.raw`\s*(?:[.,;:!?].*)?$`

const SHAPES: readonly RegExp[] = [
  // "qué citas tiene Ana" / "cuántas citas tiene Ana Torres"
  new RegExp(String.raw`\bcitas?\s+tiene\s+(?:la\s+|el\s+)?(?:client[ea]\s+)?${NAME}${TAIL}`, 'i'),
  // "citas de Ana" / "las citas de la señora Ana" / "próxima cita de Ana"
  new RegExp(String.raw`\bcitas?\s+(?:de|con|para)\s+(?:la\s+|el\s+)?(?:client[ea]\s+|se[ñn]ora?\s+)?${NAME}${TAIL}`, 'i'),
  // "cuándo viene Ana" / "cuándo vuelve Ana"
  new RegExp(String.raw`\bcuando\s+(?:viene|vuelve|regresa)\s+${NAME}${TAIL}`, 'i'),
]

export function detectClientAppointments(
  text:     string,
  today:    string,
  services: readonly CatalogService[] = [],
): ClientAppointmentsArgs | null {
  const t = normalize(text)
  if (WRITE.test(t)) return null
  if (PAST_INTENT.test(t)) return null

  for (const re of SHAPES) {
    const m = t.match(re)
    if (!m || !m[1]) continue
    const name = m[1].trim().replace(/[.,;:!?]+$/, '').trim()
    if (name.length < 2) continue
    // A "name" that is actually a date expression belongs to list-appointments.
    if (DATE_WORDS.test(name)) return null
    if (parseDateExpression(name, today)) return null
    // "próxima cita de corte" — the captured target is a service from the
    // catalog, not a client. Let the LLM handle it rather than answering
    // "No tengo a corte entre tus clientes".
    if (matchesServiceName(name, services)) return null
    return { client_name: name }
  }
  return null
}

function matchesServiceName(name: string, services: readonly CatalogService[]): boolean {
  const nameTokens = new Set(tokens(name))
  if (nameTokens.size === 0) return false
  return services.some(svc => tokens(svc.name).some(st => nameTokens.has(st)))
}
