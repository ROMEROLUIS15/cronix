/**
 * Schedule fast path — total LLM bypass when the user delivers all four
 * params in a single utterance ("agéndame a Gardi para corte el lunes a las 3").
 *
 * Strictly conservative: returns null unless we can extract client + service +
 * date + time deterministically. Partial input falls through to the LLM so the
 * prompt can ask for one missing slot at a time.
 *
 * Service is matched against the active catalog by exact token (length ≥ 3).
 * Client is captured from one of two positional patterns and validated
 * against the temporal/service stopword set to avoid pulling "mañana" or the
 * service noun in as a name.
 */

import { parseDateExpression } from '../../core/date-parser.ts'
import { parseTimeExpression } from '../../core/time-parser.ts'
import { normalize, tokens }   from '../../core/fuzzy.ts'
import type { CatalogService } from '../_shared/Capability.ts'

export interface ScheduleArgs extends Record<string, unknown> {
  client_name:          string
  service_name:         string
  date:                 string
  time:                 string
  register_new_client?: boolean
}

const VERB_ROOT = /(?:agend|reserv|program|apart)/

// Verb + suffix block at the start of the post-verb tail. The optional
// pronoun cluster (me/le/la/lo/nos/los/las) handles imperatives like
// "agéndame" / "reservale". Trailing "a/e/ar/amos/emos/aremos/ar[ae]" covers
// imperative + future tenses without grabbing the next word.
const VERB = new RegExp(
  `\\b${VERB_ROOT.source}(?:a|e|ar|ame|ale|alo|ala|anos|alos|alas|en|emos|aremos|ar[ae])\\b`,
  'i',
)

// Stopwords a captured "name" must not consist of entirely.
const NOT_A_NAME = new Set([
  'hoy', 'mañana', 'manana', 'ayer', 'anteayer', 'pasado',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
  'cita', 'citas', 'servicio', 'cliente', 'turno',
  'una', 'uno', 'un', 'la', 'el', 'los', 'las',
])

function cleanName(raw: string): string {
  return raw.trim().replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' ').trim()
}

function isNameAcceptable(name: string): boolean {
  if (name.length < 2) return false
  const words = name.split(/\s+/)
  if (words.length > 4) return false
  if (words.every(w => NOT_A_NAME.has(w.toLowerCase()))) return false
  return true
}

/**
 * Picks the service in the catalog whose name shares the most ≥3-char tokens
 * with the normalized text. Returns null when nothing matches. Ties resolve
 * to the first listed service — deterministic and order-stable.
 */
function matchServiceInText(
  normalizedText: string,
  services:       CatalogService[],
): CatalogService | null {
  let best: { svc: CatalogService; hits: number } | null = null
  for (const svc of services) {
    const ts = tokens(svc.name).filter(t => t.length >= 3)
    if (ts.length === 0) continue
    let hits = 0
    for (const t of ts) {
      const re = new RegExp(`\\b${t}\\b`)
      if (re.test(normalizedText)) hits++
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { svc, hits }
    }
  }
  return best?.svc ?? null
}

/**
 * Detects the schedule intent and returns the four args, or null when any
 * one of them can't be extracted with certainty.
 *
 * Two positional patterns tried in order:
 *   1. "agenda(...) a <CLIENT> para/con <SERVICE> ..."
 *   2. "agenda(...) <SERVICE> para <CLIENT> ..."   (less common but valid)
 *
 * Pattern 1 captures with a leading "a" / "al" preposition (the canonical
 * Spanish indirect-object marker for the booked person). Pattern 2 has no
 * preposition before the first noun so it only fires when 1 misses AND the
 * matched service token sits adjacent to the verb.
 */
export function detectSchedule(
  text:     string,
  today:    string,
  services: CatalogService[],
): ScheduleArgs | null {
  if (!text || services.length === 0) return null

  const normalized = normalize(text)
  if (!VERB.test(normalized)) return null

  const date = parseDateExpression(text, today)?.date
  const time = parseTimeExpression(text)?.time
  if (!date || !time) return null

  const matchedService = matchServiceInText(normalized, services)
  if (!matchedService) return null

  // Drop the matched service tokens from a working copy of the text so the
  // client-name regex can't accidentally grab them.
  let working = normalized
  for (const t of tokens(matchedService.name).filter(t => t.length >= 3)) {
    working = working.replace(new RegExp(`\\b${t}\\b`, 'g'), ' ')
  }
  working = working.replace(/\s+/g, ' ').trim()

  // Pattern 1: verb + "a"/"al" + <client> + connector + ...
  // Connector closes the client span at "para/con" (service was already
  // stripped, so we expect a remaining preposition or date marker).
  const P1 = new RegExp(
    `${VERB_ROOT.source}\\w*\\s+a(?:l)?\\s+(?:la\\s+|el\\s+)?(?:client[ea]\\s+)?([a-z][a-z\\s.'-]{1,60}?)\\s+(?:para|con|el|para el|a las|a la|hoy|manana|pasado|este|proximo|en\\s+\\d|\\d)`,
  )
  const m1 = working.match(P1)
  if (m1 && m1[1]) {
    const name = cleanName(m1[1])
    if (isNameAcceptable(name)) {
      return {
        client_name:  name,
        service_name: matchedService.name,
        date,
        time,
      }
    }
  }

  // Pattern 2: verb + <client>(no preposition) + para + ...
  // The "para" here introduces the (already-stripped) service slot, so what
  // sits between the verb and "para" is the client.
  const P2 = new RegExp(
    `${VERB_ROOT.source}\\w*\\s+(?:a\\s+)?(?:la\\s+|el\\s+)?([a-z][a-z\\s.'-]{1,60}?)\\s+para\\b`,
  )
  const m2 = working.match(P2)
  if (m2 && m2[1]) {
    const name = cleanName(m2[1])
    if (isNameAcceptable(name)) {
      return {
        client_name:  name,
        service_name: matchedService.name,
        date,
        time,
      }
    }
  }

  return null
}
