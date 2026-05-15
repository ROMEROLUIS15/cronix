/**
 * Fast path for client lookup intents — "tengo a X", "busca a X", "existe X",
 * "hay alguien llamado X", "cuál es el teléfono de X", etc. Read-only: write
 * verbs short-circuit so "agéndame a X" never lands here.
 */

export interface SearchClientsArgs extends Record<string, unknown> {
  query: string
}

const WRITE_AGENDAR = /\bag[eé]nd(?:a(?:r|me|lo|la|los|las|nos|ste|mos|ron)|[oé]|aremos|amos|emos|ar[ée]|ad[oa])\b/
const WRITE_OTHERS  = /\b(reagend|reprogram[aoeé]|cancel[aoeé]|borr[aoeé]|elimin[aoeé]|cre[aoeé]\s+un|nuev[ao]\s+cliente|registr[aoeé]|añad[aoeé]|agreg[aoeé])\b/

const NOT_A_NAME = new Set([
  'hoy', 'mañana', 'manana', 'ayer', 'anteayer', 'pasado',
  'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
  'cita', 'citas', 'agenda', 'algo', 'nada', 'tiempo', 'rato',
  'algún', 'algun', 'alguna', 'alguien',
  // Prepositions / determiners that leak from agenda questions like
  // "qué clientes tengo PARA MAÑANA" — preventing a stray "para mañana"
  // from being treated as a client name when list-appointments misses.
  'para', 'por', 'en', 'el', 'la', 'los', 'las', 'un', 'una', 'al', 'del',
])

const PATTERNS: RegExp[] = [
  // "tengo (a/al/la) (cliente) X (entre mis clientes)?"
  /\btengo\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+(?:entre|en|como|de)\s|\s*\?|\s*$)/i,
  // "tienes (a) X"
  /\btienes\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+(?:entre|en|como|de)\s|\s*\?|\s*$)/i,
  // "existe (el/la) (cliente) X"
  /\bexist[ea]\s+(?:el|la)?\s*(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  // "busca(me) (a) X" / "encuentra (a) X" — accent variants accepted
  /\b(?:b[uú]sca(?:me)?|encuentra|encu[eé]ntrame)\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  // "hay (algún|alguien|un) (cliente) (llamado) X"
  /\bhay\s+(?:alg[uú]n[oa]?\s+|alguien\s+|un[ao]?\s+)?(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+(?:entre|en|como|de)\s|\s*\?|\s*$)/i,
  // "cuál es el teléfono de X" / "qué teléfono tiene X" / "teléfono de X"
  /\b(?:cu[aá]l\s+es\s+el\s+tel[eé]fono\s+de|qu[eé]\s+tel[eé]fono\s+tiene|tel[eé]fono\s+de)\s+(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  // "pregunto por X" / "preguntas por X" / "qué (hay|sabes) de X"
  /\b(?:pregunt[oae]|qu[eé]\s+(?:hay|sabes)\s+de|qu[eé]\s+(?:hay|sabes)\s+sobre)\s+(?:por\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  // "conoces (a) X"
  /\bconoces\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
]

export function detectSearchClients(text: string): SearchClientsArgs | null {
  const t = text.toLowerCase().trim()
  if (WRITE_AGENDAR.test(t) || WRITE_OTHERS.test(t)) return null

  for (const re of PATTERNS) {
    const m = t.match(re)
    if (m && m[1]) {
      const name = m[1].trim().replace(/[.,;:!?]+$/, '').trim()
      if (name.length < 2 || !/[a-záéíóúñ]/i.test(name)) continue
      const words = name.split(/\s+/)
      if (words.every(w => NOT_A_NAME.has(w.toLowerCase()))) continue
      return { query: name }
    }
  }
  return null
}
