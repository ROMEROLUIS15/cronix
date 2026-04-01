/**
 * fuzzy-match.ts — Fuzzy client/service name matching for voice commands.
 *
 * Pure utility: no DB calls, no side-effects.
 * Used by the AI assistant tools to resolve spoken names → UUIDs.
 *
 * Algorithm: normalise → Levenshtein similarity → best match above threshold.
 * No external dependencies.
 */

type NamedEntity = { id: string; name: string }

// ── Normalisation ──────────────────────────────────────────────────────────
const ACCENTS: [RegExp, string][] = [
  [/[áàäâ]/g, 'a'], [/[éèëê]/g, 'e'], [/[íìïî]/g, 'i'],
  [/[óòöô]/g, 'o'], [/[úùüû]/g, 'u'], [/ñ/g, 'n'],
]

function normalize(s: string): string {
  let r = s.toLowerCase().trim()
  for (const [pat, rep] of ACCENTS) r = r.replace(pat, rep)
  return r.replace(/\s+/g, ' ')
}

// ── Levenshtein distance ───────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = dp[i]!
      const prevRow = dp[i - 1]!
      row[j] = a[i - 1] === b[j - 1]
        ? prevRow[j - 1]!
        : 1 + Math.min(prevRow[j]!, row[j - 1]!, prevRow[j - 1]!)
    }
  }
  return dp[m]![n]!
}

// ── Similarity score [0..1] ────────────────────────────────────────────────
function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length, 1)
}

const MATCH_THRESHOLD = 0.45 // tolerante para nombres hablados con errores

// ── Public API ─────────────────────────────────────────────────────────────

export type FuzzyResult<T extends NamedEntity> =
  | { status: 'found';     match: T }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'not_found' }

/**
 * Finds the best matching entity for a spoken name.
 *
 * - 'found'     → single clear winner (similarity ≥ threshold, gap > 0.15 to next)
 * - 'ambiguous' → 2+ entities with similar scores (LLM should ask for clarification)
 * - 'not_found' → no entity passes the threshold
 */
export function fuzzyFind<T extends NamedEntity>(
  entities: T[],
  spokenName: string
): FuzzyResult<T> {
  const needle = normalize(spokenName)

  const scored = entities
    .map(e => ({ entity: e, score: similarity(normalize(e.name), needle) }))
    .filter(x => x.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { status: 'not_found' }

  const best = scored[0]
  if (!best) return { status: 'not_found' }
  const second = scored[1]

  // Clear winner: gap of at least 0.15 from second best
  if (!second || best.score - second.score >= 0.15) {
    return { status: 'found', match: best.entity }
  }

  // Ambiguous: return top candidates for the LLM to disambiguate
  return {
    status: 'ambiguous',
    candidates: scored.slice(0, 3).map(x => x.entity),
  }
}
