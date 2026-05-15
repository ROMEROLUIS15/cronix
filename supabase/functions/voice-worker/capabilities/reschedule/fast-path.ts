/**
 * Fast path for reschedule. Two forms:
 *
 *  - Anaphoric ("reagéndala / muévela / cámbiala"): pronoun attached to the
 *    verb. Requires lastRef to identify the appointment.
 *  - Explicit ("reagenda a <cliente> para <fecha-hora>"): client named in
 *    the text. Falls back to the LLM when capture is noisy.
 *
 * Runs against an accent-stripped form of the text — JS regex word classes
 * don't cover Spanish accents and imperatives with attached pronouns shift
 * the stress onto the verb root ("reagéndala"). Captured names lose accents
 * in the process; that's fine because resolveClient normalises both sides.
 *
 * Anaphoric is tried first because explicit can't disambiguate a pronoun-
 * suffixed verb from a bare verb otherwise.
 */

import { parseDateExpression } from '../../core/date-parser.ts'
import { parseTimeExpression } from '../../core/time-parser.ts'
import { normalize }           from '../../core/fuzzy.ts'

export interface RescheduleArgs extends Record<string, unknown> {
  client_name:    string
  /**
   * Set when the fast path resolved the appointment via lastRef.
   * The tool looks up by this ID directly and skips the date-based search,
   * which avoids the "no encontré cita activa" bug when the existing
   * appointment is for a day other than today.
   */
  appointment_id?: string
  new_date?:      string
  new_time?:      string
}

/** Verb roots. */
const BASE = /(?:reagend|reprogram|muev|cambi)/

/** Anaphoric form: base + any chars + pronoun cluster appended. */
const ANAPHORIC = new RegExp(
  `^(?:si,?\\s+|no,?\\s+)?${BASE.source}\\w*(?:la|lo|las|los|mela|melo|melas|melos|sela|selo|nos)\\b`,
  'i',
)

/** Explicit form: base + simple imperative suffix, then space + subject. */
const EXPLICIT_CLIENT = new RegExp(
  `\\b${BASE.source}(?:a|e|ar|amos|emos|aremos)\\s+(?:al?\\s+)?(?:la\\s+)?(?:client[ea]\\s+)?(?:cita\\s+de\\s+)?([a-z][a-z\\s.'-]{1,80}?)\\s+(?:para|a|al)\\b`,
  'i',
)

export function detectReschedule(
  text:    string,
  today:   string,
  lastRef: { clientName: string; appointmentId?: string } | null,
): RescheduleArgs | null {
  const t = normalize(text)

  const newDate = parseDateExpression(text, today)?.date ?? undefined
  const newTime = parseTimeExpression(text)?.time     ?? undefined
  if (!newDate && !newTime) return null

  // Anaphoric path first — pronoun-suffixed verbs look like bare verbs to the
  // explicit regex if checked in the wrong order.
  if (ANAPHORIC.test(t) && lastRef) {
    return {
      client_name:    lastRef.clientName,
      appointment_id: lastRef.appointmentId,
      new_date:       newDate,
      new_time:       newTime,
    }
  }

  const m = t.match(EXPLICIT_CLIENT)
  if (m && m[1]) {
    const name = m[1].trim().replace(/[.,;:!?]+$/, '').trim()
    if (name.length >= 2) {
      return { client_name: name, new_date: newDate, new_time: newTime }
    }
  }

  return null
}
