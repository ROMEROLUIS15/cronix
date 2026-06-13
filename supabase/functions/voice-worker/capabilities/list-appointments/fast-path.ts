/**
 * Fast path for "qué citas tengo <fecha>" / "muéstrame mi agenda del ..." /
 * "cuáles son las citas del ...". Uses the deterministic Spanish date parser
 * so the agent handles any absolute, relative or weekday-based date the user
 * speaks — not just hoy/mañana/pasado.
 *
 * Read-only — never matches when a write verb is present in the same turn.
 */

import { parseDateExpression } from '../../core/date-parser.ts'

export interface ListAppointmentsArgs extends Record<string, unknown> {
  date: string
}

// "agenda" alone is ambiguous (sustantivo = calendar vs. verbo = book). We
// only block the verb conjugations; "agenda de hoy" stays in the read path.
const WRITE_AGENDAR = /\bag[eé]nd(?:a(?:r|me|lo|la|los|las|nos|ste|mos|ron)|[oé]|aremos|amos|emos|ar[ée]|ad[oa])\b/
const WRITE_OTHERS  = /\b(reagend|reprogram[aoeé]|cancel[aoeé]|borr[aoeé]|elimin[aoeé]|cre[aoeé]\s+un|nuev[ao]\s+cliente|registr[aoeé]|añad[aoeé]|agreg[aoeé])\b/

// "muéstrame los servicios de hoy" carries both a QUERY verb and a date, but
// it's a catalog question, not an agenda one — defer to get-services / LLM.
const SERVICE_INTENT = /\bservicios?\b/

// Includes "qué/cuántos clientes (tengo|hay|atiendo)" because in colloquial
// Spanish the owner uses "clientes" as a synonym for "citas" when asking
// the agenda ("qué clientes tengo mañana" = "what bookings tomorrow").
const QUERY = /(\bqu[eé]\s+citas?\b|\bcitas\s+(de|hay|tengo|para|del|que|en|dentro)\b|\bagenda\b|\bmis?\s+citas\b|\bqu[eé]\s+tengo\b|\bcu[aá]les\s+son\s+mis?\s+citas\b|\bmu[eé]strame\b|\blist[aoeé]\s+(?:mis\s+)?citas\b|\b(?:qu[eé]|cu[aá]ntos?)\s+clientes?\s+(?:tengo|hay|atiendo|atender[eé]|atender[ée]mos)\b|\bclientes?\s+(?:tengo|hay|para|del|de\s+hoy|de\s+ma[ñn]ana)\b)/

export function detectListAppointments(text: string, today: string): ListAppointmentsArgs | null {
  const t = text.toLowerCase()
  if (WRITE_AGENDAR.test(t) || WRITE_OTHERS.test(t)) return null
  if (SERVICE_INTENT.test(t)) return null
  if (!QUERY.test(t)) return null

  const parsed = parseDateExpression(text, today)
  if (!parsed) return null
  return { date: parsed.date }
}
