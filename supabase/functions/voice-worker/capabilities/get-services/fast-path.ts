/**
 * Fast path for catalog questions — "qué servicios tienes", "hay servicios
 * disponibles", "lista de servicios", "qué ofreces", "muéstrame el menú".
 * Deterministic and read-only, so a false positive is harmless (the user
 * hears the catalog). It exists because these phrasings used to leak into
 * search-clients' name capture and the agent answered "no encontré a
 * 'servicios disponibles' entre tus clientes".
 *
 * Patterns run against the accent-stripped, lowercased form (normalize) so
 * "qué"/"que" and "menú"/"menu" both match. "tratamiento(s)" is accepted as a
 * salon synonym of "servicio(s)".
 *
 * Conservative on purpose: schedule phrases like "agéndale el servicio de
 * manicure a Ana" never match (they carry a write verb and run earlier in the
 * registry anyway).
 */

import { normalize } from '../../core/fuzzy.ts'

// servicio(s) / tratamiento(s) — the catalog nouns this business speaks.
const SVC = '(?:servicios?|tratamientos?)'

const PATTERNS: RegExp[] = [
  // "qué/cuáles (son) (los/tus/mis) servicios" — trailing verb (tienes,
  // ofreces, manejas…) is ignored, the noun anchors the match.
  new RegExp(`\\b(?:que|cuales?)\\s+(?:son\\s+)?(?:los\\s+|tus\\s+|mis\\s+)?${SVC}\\b`),
  // "servicios disponibles / activos / del negocio"
  new RegExp(`\\b${SVC}\\s+(?:disponibles|activos|del\\s+negocio)\\b`),
  // "(hay|tienes|tenemos|ofreces|ofrecen|manejan|dan|realizan|hacen) servicios"
  new RegExp(`\\b(?:hay|tienes|tenemos|ofreces?|ofrecen|manejan?|dan|realiz\\w+|hacen)\\s+(?:algunos?\\s+)?${SVC}\\b`),
  // "lista(me)/muéstra(me)/dime/dame/enséñame (los) servicios" / "lista de servicios"
  new RegExp(`\\b(?:lista(?:me)?|muestra(?:me)?|dime|dame|ensena(?:me)?)\\s+(?:de\\s+)?(?:los\\s+|tus\\s+|mis\\s+)?${SVC}\\b`),
  // Catalog ask with the noun elided: "qué ofreces / qué ofrecen / qué me ofreces"
  /\bque\s+(?:me\s+)?(?:ofreces|ofrecen)\b/,
  // "menú / catálogo (de servicios)"
  /\b(?:menu|catalogo)\b/,
]

export function detectGetServices(text: string): Record<string, never> | null {
  const t = normalize(text)
  for (const re of PATTERNS) {
    if (re.test(t)) return {}
  }
  return null
}
