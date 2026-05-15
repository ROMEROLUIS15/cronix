/**
 * Fast path for cancel. Two forms:
 *
 *  - Anaphoric ("cancélala / cancela esa cita"): pronoun attached or "esa
 *    cita" reference. Needs lastRef.
 *  - Explicit ("cancela la cita de <cliente>"): client named in the text.
 *
 * Same accent-stripping + anaphoric-first ordering as reschedule.
 */

import { parseDateExpression } from '../../core/date-parser.ts'
import { parseTimeExpression } from '../../core/time-parser.ts'
import { normalize }           from '../../core/fuzzy.ts'

export interface CancelArgs extends Record<string, unknown> {
  client_name:    string
  /** When supplied (anaphoric path), the tool looks up by ID directly. */
  appointment_id?: string
  date?:          string
  time?:          string
}

const BASE = /(?:cancel|quita|elimina|borra)/

/** Pronoun-suffixed verb. */
const ANAPHORIC_VERB = new RegExp(
  `^(?:si,?\\s+)?${BASE.source}\\w*(?:la|lo|las|los|mela|melo|melas|melos|sela|selo)\\b`,
  'i',
)

/** Bare imperative followed by a reference noun phrase. */
const ANAPHORIC_PHRASE = new RegExp(
  `^(?:si,?\\s+)?${BASE.source}(?:a|e|ar|amos|emos)\\s+(?:la|lo|esa\\s+cita|esta\\s+cita|aquella\\s+cita|mi\\s+cita)\\s*\\.?\\??$`,
  'i',
)

const EXPLICIT_CLIENT = new RegExp(
  `\\b${BASE.source}(?:a|e|ar|amos|emos)\\s+(?:la\\s+cita\\s+de\\s+|a\\s+|al\\s+|de\\s+)(?:la\\s+)?(?:client[ea]\\s+)?([a-z][a-z\\s.'-]{1,80}?)(?:\\s+(?:del|de|para|a)\\s|\\s*\\?|\\s*$|\\s*\\.)`,
  'i',
)

const NOT_A_NAME = new Set([
  'la', 'lo', 'esa', 'esta', 'aquella', 'cita', 'mi',
  'hoy', 'manana', 'ayer', 'pasado',
])

export function detectCancel(
  text:    string,
  today:   string,
  lastRef: { clientName: string; appointmentId?: string } | null,
): CancelArgs | null {
  const t = normalize(text)

  const date = parseDateExpression(text, today)?.date ?? undefined
  const time = parseTimeExpression(text)?.time     ?? undefined

  // Anaphoric first — pronoun-attached verb or "esa cita" reference.
  if ((ANAPHORIC_VERB.test(t) || ANAPHORIC_PHRASE.test(t)) && lastRef) {
    return {
      client_name:    lastRef.clientName,
      appointment_id: lastRef.appointmentId,
      date, time,
    }
  }

  const m = t.match(EXPLICIT_CLIENT)
  if (m && m[1]) {
    const name = m[1].trim().replace(/[.,;:!?]+$/, '').trim()
    if (name.length < 2) return null
    const words = name.split(/\s+/)
    if (words.every(w => NOT_A_NAME.has(w))) return null
    return { client_name: name, date, time }
  }

  return null
}
