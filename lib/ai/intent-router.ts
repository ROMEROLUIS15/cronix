/**
 * intent-router.ts — Zero-LLM fast path para intents de alta frecuencia.
 *
 * Detecta la intención del usuario por keywords normalizados ANTES de entrar
 * al ReAct loop. Si hay match con alta confianza → el tool se ejecuta directamente
 * sin gastar tokens en el LLM.
 *
 * Principio: el LLM es el sistema de razonamiento, no el default para todo.
 * Para queries de lectura simples y predecibles, esta capa ahorra ~50% de los tokens.
 *
 * REGLA: Solo agregar aquí intents READ de resultado determinista.
 * Nunca agregar WRITE intents (book, cancel, register) — esos siempre van al LLM
 * porque requieren confirmación de parámetros del usuario y razonamiento.
 *
 * ## Estrategia de matching (3 capas):
 *
 * 1. Exact substring match  — substring exacto del keyword en el query (confianza máxima)
 * 2. Fuzzy keyword match    — Levenshtein similarity ≥ 0.82 entre palabras del query y del keyword
 *                             (tolera errores de STT: "balanse" → "balance", "resurmen" → "resumen")
 * 3. LLM ReAct loop         — fallback cuando ningún intent pasa el umbral
 *
 * Phase 5 — Scaling: fuzzy layer permite extender la cobertura del router sin
 * pre-computar embeddings. Los embeddings siguen siendo la siguiente evolución
 * si el negocio requiere routing semántico cross-idioma o intents complejos.
 */

import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchedIntent {
  toolName: string
  args?: Record<string, unknown>
}

export type RouterResult =
  | { matched: true;  intent: MatchedIntent; matchType: 'exact' | 'fuzzy' }
  | { matched: false }

// ── Text normalization ─────────────────────────────────────────────────────────

/**
 * Normaliza el texto del usuario para un matching robusto:
 * - minúsculas
 * - sin acentos (maneja voz mal transcrita: "cuántas" → "cuantas")
 * - sin puntuación interrogativa/exclamativa
 * - espacios colapsados
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar diacríticos
    .replace(/[¿?¡!.,;:]/g, '')      // quitar puntuación
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Levenshtein similarity ─────────────────────────────────────────────────────
// Inline (no import) to avoid coupling this module to fuzzy-match.ts internals.
// fuzzy-match.ts is domain-specific (client/service resolution); this is routing.

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0] ?? 0
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j] ?? 0
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j] ?? 0, dp[j - 1] ?? 0)
      prev = tmp
    }
  }
  return dp[n] ?? 0
}

function wordSimilarity(a: string, b: string): number {
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length, 1)
}

// ── Intent pattern table ───────────────────────────────────────────────────────
// Orden importa: más específico → más general.
// Cada entrada puede tener múltiples keywords; basta con que UNO haga match.

const INTENT_PATTERNS: Array<{
  toolName: string
  keywords: string[]
  args?: Record<string, unknown>
}> = [
  // ─ Citas de mañana / fecha específica ───────────────────────────────────────
  // NOTE: These patterns intentionally contain future-date words — they are exempt
  // from the future-date guard (which only skips TODAY_ONLY_TOOLS).
  // `args.date` is computed HERE (not by the LLM) since this is the fast-path.
  {
    toolName: 'get_appointments_by_date',
    keywords: [
      'citas de manana',
      'agenda de manana',
      'que tengo manana',
      'que citas hay manana',
      'cuantas citas hay manana',
      'citas para manana',
      'quien viene manana',
    ],
    // Compute tomorrow's date at route time so the fast-path handler has a valid `date` arg
    get args() {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      return { date: tomorrow.toISOString().split('T')[0] }
    },
  },

  // ─ Resumen del día ──────────────────────────────────────────────────────────
  {
    toolName: 'get_today_summary',
    keywords: [
      'resumen de hoy',
      'resumen del dia',
      'como va el dia',
      'como vamos hoy',
      'cuantas citas hay hoy',
      'citas de hoy',
      'agenda de hoy',
      'que tenemos hoy',
      'reporte del dia',
      'balance del dia',
    ],
  },

  // ─ Huecos libres / disponibilidad ──────────────────────────────────────────
  {
    toolName: 'get_upcoming_gaps',
    keywords: [
      'hay espacio libre',
      'hay hueco',
      'cuando hay disponible',
      'horario disponible',
      'horario libre',
      'espacios libres',
      'proximos espacios',
      'cuando puedo agendar',
      'hay lugar hoy',
    ],
  },

  // ─ Ingresos / estadísticas semanales ────────────────────────────────────────
  {
    toolName: 'get_revenue_stats',
    keywords: [
      'cuanto facture',
      'cuanto gane',
      'ingresos de esta semana',
      'estadisticas de la semana',
      'ventas de esta semana',
      'como van los ingresos',
      'comparacion de semanas',
      'cuanto llevamos',
    ],
  },

  // ─ Catálogo de servicios ────────────────────────────────────────────────────
  {
    toolName: 'get_services',
    keywords: [
      'que servicios tienen',
      'que servicios ofrecen',
      'que hacen',
      'cuanto cuesta',
      'lista de servicios',
      'catalogo',
      'precios',
      'tratamientos disponibles',
      'que opciones hay',
    ],
  },

  // ─ Proyección mensual / forecast ────────────────────────────────────────────
  {
    toolName: 'get_monthly_forecast',
    keywords: [
      'proyeccion del mes',
      'cuanto vamos a cerrar',
      'cierre del mes',
      'estimado del mes',
      'cuanto falta para cerrar',
      'proyeccion mensual',
      'como va el mes',
    ],
  },

  // ─ Clientes inactivos ───────────────────────────────────────────────────────
  {
    toolName: 'get_inactive_clients',
    keywords: [
      'clientes inactivos',
      'quienes no han venido',
      'clientes que no vienen',
      'clientes perdidos',
      'quien falta',
      'clientes sin visita',
      'hace tiempo que no vienen',
    ],
  },
]

// ── Fuzzy matching ─────────────────────────────────────────────────────────────

const FUZZY_THRESHOLD = 0.82 // High bar — we'd rather fall through to LLM than misroute

/**
 * Checks if any word in the query fuzzy-matches any word in the keyword phrase.
 * Handles STT transcription errors: "resurmen" → "resumen", "cuantass" → "cuantas".
 */
function fuzzyKeywordMatch(queryNorm: string, keywordNorm: string): boolean {
  const queryWords   = queryNorm.split(' ').filter(w => w.length >= 4)   // skip short words
  const keywordWords = keywordNorm.split(' ').filter(w => w.length >= 4)

  if (queryWords.length === 0 || keywordWords.length === 0) return false

  // Each keyword word must have at least ONE query word that matches it
  const matchedPhraseWords = keywordWords.filter(kw =>
    queryWords.some(qw => wordSimilarity(qw, kw) >= FUZZY_THRESHOLD)
  )

  // Require ≥ 50% of the keyword words to match (avoids false positives on long phrases)
  return matchedPhraseWords.length >= Math.ceil(keywordWords.length * 0.5)
}

// ── Numeric date extraction ────────────────────────────────────────────────────
// Resolves "el día 16", "citas del 20", "para el 5 de mayo" into a concrete ISO date.
// Date arithmetic is done HERE — not delegated to the 8B LLM which miscalculates it.
//
// Month resolution rules (when no month name is specified):
//   - dayNum > today        → current month
//   - dayNum === today      → today (still a valid specific-date query)
//   - dayNum < today        → next month (assume they mean the upcoming occurrence)
//
// Requires at least one appointment-context keyword to avoid false positives
// (e.g. "tengo 16 clientes" should NOT match).

const APPOINTMENT_CONTEXT_SIGNALS = ['cita', 'agenda', 'tengo', 'hay', 'quien', 'viene', 'para']

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

// Ordered from most-specific to least-specific to avoid partial over-matches.
const NUMERIC_DAY_PATTERNS: RegExp[] = [
  /\bel\s+dia\s+(\d{1,2})\b/,        // "el dia 16"
  /\bdel\s+dia\s+(\d{1,2})\b/,       // "del dia 16"
  /\bpara\s+el\s+dia\s+(\d{1,2})\b/, // "para el dia 16"
  /\bpara\s+el\s+(\d{1,2})\b/,       // "para el 16"
  /\bcitas\s+del\s+(\d{1,2})\b/,     // "citas del 20"
  /\bagenda\s+del\s+(\d{1,2})\b/,    // "agenda del 20"
  /\bel\s+(\d{1,2})\s+de\b/,         // "el 16 de abril"
  /\bdia\s+(\d{1,2})\b/,             // "dia 16" (looser — last resort)
]

function extractNumericDate(normalized: string): string | null {
  // Require appointment context to avoid false positives
  if (!APPOINTMENT_CONTEXT_SIGNALS.some(s => normalized.includes(s))) return null

  let dayNum: number | null = null
  for (const pattern of NUMERIC_DAY_PATTERNS) {
    const match = pattern.exec(normalized)
    if (match) {
      const n = parseInt(match[1] ?? '', 10)
      if (n >= 1 && n <= 31) { dayNum = n; break }
    }
  }
  if (dayNum === null) return null

  // Check for explicit month name ("el 16 de abril", "citas del 20 de mayo")
  const now    = new Date()
  let year     = now.getFullYear()
  let month    = now.getMonth() + 1  // 1-based

  for (const [name, num] of Object.entries(MONTH_MAP)) {
    if (normalized.includes(name)) {
      month = num
      // If the named month is earlier than the current month, it must be next year
      if (num < now.getMonth() + 1) year++
      break
    }
  }

  // No explicit month — resolve by comparing day against today
  const monthExplicit = Object.keys(MONTH_MAP).some(m => normalized.includes(m))
  if (!monthExplicit && dayNum < now.getDate()) {
    // Day has already passed this month → roll to next month
    month = now.getMonth() + 2
    if (month > 12) { month = 1; year++ }
  }

  // Validate date integrity (e.g. Feb 30 → invalid)
  const candidate = new Date(year, month - 1, dayNum)
  if (candidate.getMonth() !== month - 1) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Intenta resolver el intent del usuario sin llamar al LLM.
 *
 * Estrategia en cascada:
 *  0. Numeric date fast-path (fecha específica como "el día 16" → ISO date calculada aquí)
 *  1. Exact substring match (máxima confianza, sin costo)
 *  2. Fuzzy word-level match (tolera errores de STT, umbral 0.82)
 *  3. { matched: false } → el caller usa el ReAct loop
 *
 * @param userText  - Texto transcrito del usuario (STT output)
 * @param userId    - Para logging (opcional)
 * @returns RouterResult — si matched=true, el caller puede skip el ReAct loop
 */
// ── Write-intent guard ────────────────────────────────────────────────────────
// These words signal that the user wants to PERFORM an action, not READ data.
// A query like "agendar una cita hoy" would otherwise fuzzy-match "agenda de hoy"
// → get_today_summary — completely wrong. Write intents always go to the LLM.
const WRITE_INTENT_SIGNALS = [
  'agenda una', 'quiero agendar', 'necesito agendar', 'voy a agendar',
  'cancelar', 'cancela', 'quiero cancelar',
  'reagendar', 'mover la cita', 'cambiar la cita', 'reagenda',
  'cobrar', 'registrar pago', 'registrar cobro',
  'crear cliente', 'nuevo cliente', 'agregar cliente', 'crea un cliente',
]

// ── Ambiguous query guard ─────────────────────────────────────────────────────
// These phrases are too ambiguous or conversational for the fast path.
// They would otherwise fuzzy-match READ intents incorrectly.
const AMBIGUOUS_SIGNALS = [
  'como estas',
  'mejor cliente',
  'saber sobre las citas',
]

// ── Future-date guard ─────────────────────────────────────────────────────────
// Queries referencing a future date must never hit today-only tools.
// Without this, "qué citas tengo para mañana" fuzzy-matches "citas de hoy"
// on the single word "citas" (only word ≥4 chars in that keyword) → wrong tool.
// These queries fall through to the LLM or to the get_appointments_by_date fast-path.
//
// NOTE: Uses word-boundary check to avoid false blocking (e.g. "proximos espacios"
// should NOT be blocked — "proximos" is not the same as "proximo" as a standalone date ref).
const FUTURE_DATE_SIGNALS = [
  'manana', 'pasado manana', 'semana que viene', 'proxima semana',
  'el lunes', 'el martes', 'el miercoles', 'el jueves', 'el viernes',
  'el sabado', 'el domingo',
]

// Regex for explicit numeric date references: "el día 16", "para el 16", "del 16", "el 16 de"
// Using normalized text (no accents, lowercase) so "día" → "dia".
// NOT matched: "el dia de hoy" (no number), "agenda de hoy" (no number).
const NUMERIC_DATE_RE = /\b(el\s+dia\s+\d+|para\s+el\s+\d+|del\s+dia\s+\d+|el\s+\d+\s+de)\b/

// Tools whose data scope is strictly TODAY — must not fire on future-date queries
const TODAY_ONLY_TOOLS = new Set(['get_today_summary', 'get_upcoming_gaps'])

export function routeIntent(userText: string, userId?: string): RouterResult {
  const normalized = norm(userText)

  // Guard: queries muy cortas son ambiguas — dejar al LLM razonar
  if (normalized.length < 8) {
    return { matched: false }
  }

  // Guard: write-intent queries must NEVER hit a READ fast path.
  // The LLM handles all write actions — it collects parameters and confirms.
  if (WRITE_INTENT_SIGNALS.some(signal => normalized.includes(norm(signal)))) {
    logger.info('AI-ROUTER', 'Write intent detected — bypassing fast path', {
      userId,
      query: normalized.slice(0, 60),
    })
    return { matched: false }
  }

  // Guard: ambiguous/conversational queries should fall through to the LLM.
  if (AMBIGUOUS_SIGNALS.some(signal => normalized.includes(norm(signal)))) {
    return { matched: false }
  }

  // Detect if the query references a specific future/non-today date.
  // Two mechanisms:
  //   1. Keyword signals ("mañana", "el viernes", etc.)
  //   2. Numeric date regex ("el día 16", "para el 5", "el 16 de abril")
  // Either one blocks today-only tools from firing.
  const hasFutureDate =
    FUTURE_DATE_SIGNALS.some(sig => normalized.includes(norm(sig))) ||
    NUMERIC_DATE_RE.test(normalized)

  // ── Layer 1: Exact substring match ────────────────────────────────────────
  for (const pattern of INTENT_PATTERNS) {
    // Skip today-only tools when the query references a future date
    if (hasFutureDate && TODAY_ONLY_TOOLS.has(pattern.toolName)) continue

    const hasExact = pattern.keywords.some(kw => normalized.includes(norm(kw)))

    if (hasExact) {
      logger.info('AI-ROUTER', `[exact] Intent matched: ${pattern.toolName}`, {
        userId,
        query: normalized.slice(0, 60),
      })
      return {
        matched:   true,
        matchType: 'exact',
        intent: {
          toolName: pattern.toolName,
          args:     pattern.args ?? {},
        },
      }
    }
  }

  // ── Layer 2: Fuzzy word-level match ───────────────────────────────────────
  // Only runs if exact matching failed — avoids redundant work on common queries.
  for (const pattern of INTENT_PATTERNS) {
    // Skip today-only tools when the query references a future date
    if (hasFutureDate && TODAY_ONLY_TOOLS.has(pattern.toolName)) continue

    const hasFuzzy = pattern.keywords.some(kw => fuzzyKeywordMatch(normalized, norm(kw)))

    if (hasFuzzy) {
      logger.info('AI-ROUTER', `[fuzzy] Intent matched: ${pattern.toolName}`, {
        userId,
        query: normalized.slice(0, 60),
      })
      return {
        matched:   true,
        matchType: 'fuzzy',
        intent: {
          toolName: pattern.toolName,
          args:     pattern.args ?? {},
        },
      }
    }
  }

  return { matched: false }
}
