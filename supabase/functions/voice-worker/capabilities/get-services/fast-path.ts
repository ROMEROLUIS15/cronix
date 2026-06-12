/**
 * Fast path for catalog questions — "qué servicios tienes", "hay servicios
 * disponibles", "lista de servicios". Deterministic and read-only, so a false
 * positive is harmless (the user hears the catalog). It exists because these
 * phrasings used to leak into search-clients' name capture and the agent
 * answered "no encontré a 'servicios disponibles' entre tus clientes".
 *
 * Conservative on purpose: every pattern requires the word servicio(s) in a
 * question/listing shape. Schedule phrases like "agéndale el servicio de
 * manicure a Ana" never match (they carry a write verb and run earlier in the
 * registry anyway).
 */

const PATTERNS: RegExp[] = [
  // "qué/cuáles (son) (los/tus/mis) servicios (tienes|ofreces|hay|...)"
  /\b(?:qu[eé]|cu[aá]les?)\s+(?:son\s+)?(?:los\s+|tus\s+|mis\s+)?servicios?\b/,
  // "servicios disponibles" / "servicios activos" / "servicios del negocio"
  /\bservicios\s+(?:disponibles|activos|del\s+negocio)\b/,
  // "(hay|tienes|tenemos|ofreces) servicios"
  /\b(?:hay|tienes|tenemos|ofreces?)\s+(?:algunos?\s+)?servicios\b/,
  // "lista(me)/muestra(me)/dime los servicios" / "lista de servicios"
  /\b(?:l[ií]sta(?:me)?|muestra(?:me)?|mu[eé]strame|dime|dame)\s+(?:de\s+)?(?:los\s+|tus\s+|mis\s+)?servicios\b/,
]

export function detectGetServices(text: string): Record<string, never> | null {
  const t = text.toLowerCase().trim()
  for (const re of PATTERNS) {
    if (re.test(t)) return {}
  }
  return null
}
