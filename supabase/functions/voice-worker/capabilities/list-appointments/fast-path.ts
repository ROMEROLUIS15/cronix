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

// A sentence that opens with "agenda" and is not followed by a date or "de/del/para" is an order:
// "agenda una cita para Ana", "agenda a Ana mañana". "agenda de hoy" stays a question.
const AGENDA_COMMAND = /(?:^|[,;.]\s*|\b(?:por favor|oye|dale|bueno)\s+)agenda\s+(?!(?:de|del|para|en|hoy|ma[ñn]ana|pasado)\b)/
// "mueve las citas de Ana al viernes" mentions citas, but it asks to change them.
const CHANGE_ORDER = /\b(?:muev|mover|cambi)\w*|\bpas(?:a|ar|ale|e)\b/

/** True when the sentence asks to see the agenda, and is not an order. */
export function isAgendaQuestion(text: string): boolean {
  const t = text.toLowerCase()
  if (AGENDA_COMMAND.test(t) || CHANGE_ORDER.test(t) || WRITE_AGENDAR.test(t) || WRITE_OTHERS.test(t)) return false
  if (SERVICE_INTENT.test(t)) return false
  return QUERY.test(t)
}

export function detectListAppointments(text: string, today: string): ListAppointmentsArgs | null {
  if (!isAgendaQuestion(text)) return null

  // Agenda queries can be past OR future ("qué citas tuve el 9 de junio" vs
  // "qué citas tengo el 20"). Use 'nearest' so a bare day+month resolves to the
  // occurrence closest to today instead of always rolling into next year.
  const parsed = parseDateExpression(text, today, 'nearest')
  if (!parsed) return null
  return { date: parsed.date }
}
