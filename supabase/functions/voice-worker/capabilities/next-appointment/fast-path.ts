/**
 * Fast path for "cuál es mi próxima cita" / "siguiente cita" / "qué viene
 * después" / "quién sigue ahora". Matches only when the user asks for the
 * NEXT-in-time appointment (no specific date keyword). If the phrase mentions
 * a date ("próxima cita del viernes"), this returns null so list-appointments
 * handles it; if it names a client ("próxima cita de Ana"), client-appointments
 * handles it.
 *
 * Patterns run against the accent-stripped, lowercased form (normalize) so
 * "próxima"/"proxima" — and STT output that drops accents — both match without
 * peppering every vowel with a [oó]-style character class.
 *
 * Read-only — blocks on any write verb in the same turn.
 */

import { normalize } from '../../core/fuzzy.ts'

export type NextAppointmentFastPathArgs = Record<string, unknown>

const WRITE = /\b(agenda\w*|reagenda\w*|reprogram\w*|cancel\w*|borr\w*|elimin\w*|crea\w*|registr\w*|nuev[ao]s?)\b/

// "próxima/siguiente/próximo + cita/turno/cliente/paciente" — singular only.
// Plural ("próximas citas") is an agenda query, not next-in-time, so the
// trailing -s on the noun is intentionally excluded.
const NEXT_INTENT = /\b(?:proxima|siguiente|proximo)\s+(?:cita|turno|cliente|paciente)\b/

// Noun elided: "qué/cuál/cuándo/quién (es) (el/la/mi) próxima/siguiente".
const NEXT_INTENT_VERB = /\b(?:que|cual|cuando|quien)\s+(?:es\s+)?(?:el\s+|la\s+|mi\s+)?(?:proxima|proximo|siguiente)\b/

// "qué/quién viene/sigue".
const NEXT_INTENT_LOOSE = /\b(?:que|quien)\s+(?:viene|sigue)\b/

// Now-relative: "qué tengo ahora/después", "a quién atiendo/veo ahora".
const NEXT_INTENT_NOW = /\b(?:que|a\s+quien)\s+(?:tengo|atiendo|veo|sigue|viene)\s+(?:ahora|despues|enseguida|de\s+una)\b/

// Block if the user named a specific date — let list-appointments handle it.
const HAS_DATE_KEYWORD = /\b(hoy|manana|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\d{1,2}\s*(?:de|\/))/

// "próxima cita de Ana" targets a CLIENT — defer to client-appointments.
const HAS_CLIENT_TARGET = /\b(?:cita|turno)\s+(?:de|con|para)\s+[a-z]/

export function detectNextAppointment(text: string): NextAppointmentFastPathArgs | null {
  const t = normalize(text)
  if (WRITE.test(t)) return null
  if (HAS_DATE_KEYWORD.test(t)) return null
  if (HAS_CLIENT_TARGET.test(t)) return null

  if (
    NEXT_INTENT.test(t) ||
    NEXT_INTENT_VERB.test(t) ||
    NEXT_INTENT_LOOSE.test(t) ||
    NEXT_INTENT_NOW.test(t)
  ) {
    return {}
  }
  return null
}
