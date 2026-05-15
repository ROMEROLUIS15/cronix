/**
 * last_visit fast path. Variants of "cuándo fue la última vez que atendí a X":
 *
 *   - "última vez que (se )?(atendí|atendió|vino|asistió|fue atendido) X"
 *   - "última cita/visita de X"
 *   - "cuándo (vino|fue atendido|asistió|atendí) X"
 *   - "qué día fue la última vez que ..."
 *   - "dime cuándo vino X" / "dime la última visita de X"
 *
 * Returns null on write intents (agenda/reagenda/cancela/elimina) and on
 * noise-only captures ("hoy", "mañana", generic nouns). The capability lives
 * BEFORE search-clients in the registry — "última cita de X" would otherwise
 * be hijacked by search-clients' loose name regex.
 *
 * JS regex `\b` doesn't recognise accented letters, so patterns starting
 * with "última" anchor on `(?:^|\s)` instead.
 */

export interface LastVisitFastPathArgs extends Record<string, unknown> {
  client_name: string
}

const WRITE = /\b(ag[eé]nd[aoeé]|reagend|reprogram[aoeé]|cancel[aoeé]|borr[aoeé]|elimin[aoeé])\b/

const NOT_A_NAME = new Set([
  'hoy', 'mañana', 'manana', 'ayer', 'anteayer',
  'cita', 'citas', 'algo', 'nada', 'algún', 'algun', 'alguien',
])

const PATTERNS: RegExp[] = [
  /(?:^|\s)[uú]ltima\s+vez\s+que\s+(?:se\s+)?(?:atend[ií](?:[óoaá]|\s+a)?|vino|asisti[óo]|fue\s+atendid[oa])\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  /(?:^|\s)[uú]ltima\s+(?:cita|visita)\s+(?:de|para|que\s+tuvo)\s+(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  /\bcu[aá]ndo\s+(?:vino|fue\s+atendid[oa]|asisti[óo]|atend[ií])\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+por\s+[uú]ltima\s+vez)?(?:\s*\?|\s*$)/i,
  /\bqu[eé]\s+d[ií]a\s+(?:fue\s+)?(?:la\s+)?[uú]ltima\s+vez\s+que\s+(?:se\s+)?(?:atend[ií](?:[óoaá]|\s+a)?|vino|asisti[óo]|fue\s+atendid[oa])\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  /\bdime\s+(?:la\s+[uú]ltima\s+(?:vez|cita|visita)\s+(?:que\s+(?:se\s+)?(?:atend[ií](?:[óoaá]|\s+a)?|vino|asisti[óo]))?|cu[aá]ndo\s+(?:vino|atend[ií]|asisti[óo]|fue\s+atendid[oa]))\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
]

export function detectLastVisit(text: string): LastVisitFastPathArgs | null {
  const t = text.toLowerCase().trim()
  if (WRITE.test(t)) return null

  for (const re of PATTERNS) {
    const m = t.match(re)
    if (m && m[1]) {
      const name = m[1].trim().replace(/[.,;:!?]+$/, '').trim()
      if (name.length < 2 || !/[a-záéíóúñ]/i.test(name)) continue
      const words = name.split(/\s+/)
      if (words.every(w => NOT_A_NAME.has(w.toLowerCase()))) continue
      return { client_name: name }
    }
  }

  return null
}
