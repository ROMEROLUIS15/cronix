/**
 * Fast path for "cuál es mi próxima cita" / "siguiente cita" / "qué viene
 * después". Matches only when the user asks for the NEXT-in-time
 * appointment (no specific date keyword). If the phrase mentions a date
 * ("próxima cita del viernes"), this returns null so list-appointments
 * handles it.
 *
 * Read-only — blocks on any write verb in the same turn.
 */

export type NextAppointmentFastPathArgs = Record<string, unknown>

const WRITE = /\b(ag[eé]nda\w*|reagenda\w*|reprogram\w*|cancel[aoeé]\w*|borr[aoeé]\w*|elimin[aoeé]\w*|crea\w*|nuev[ao]s?)\b/

// "próxima/siguiente/próximo + cita/citas/cliente/turno" — singular only.
// We require singular because plural ("próximas citas") usually means
// "agenda" not "next-in-time", and we don't want to clobber list flow.
const NEXT_INTENT = /\b(?:pr[oó]xima|siguiente|pr[oó]ximo)\s+(?:cita|turno|cliente)\b/

// Variations like "qué/cuál es la próxima/siguiente", "cuándo es mi próxima/siguiente"
const NEXT_INTENT_VERB = /\b(?:qu[eé]|cu[aá]l|cu[aá]ndo)\s+(?:es\s+(?:la|mi)\s+)?(?:pr[oó]xima|siguiente)\b/

// "qué viene (ahora|después)" / "qué sigue"
const NEXT_INTENT_LOOSE = /\bqu[eé]\s+(?:viene|sigue)\b/

// Block if the user mentioned a specific date keyword — let list-appointments handle it.
const HAS_DATE_KEYWORD = /\b(hoy|ma[ñn]ana|ayer|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\d{1,2}\s*(?:de|\/))/

// "próxima cita de Ana" targets a CLIENT, not the global next-in-time —
// defer to client-appointments (registered right after this capability).
const HAS_CLIENT_TARGET = /\b(?:cita|turno)\s+(?:de|con|para)\s+[a-záéíóúüñ]/

export function detectNextAppointment(text: string): NextAppointmentFastPathArgs | null {
  const t = text.toLowerCase().trim()
  if (WRITE.test(t)) return null
  if (HAS_DATE_KEYWORD.test(t)) return null
  if (HAS_CLIENT_TARGET.test(t)) return null

  if (NEXT_INTENT.test(t) || NEXT_INTENT_VERB.test(t) || NEXT_INTENT_LOOSE.test(t)) {
    return {}
  }
  return null
}
