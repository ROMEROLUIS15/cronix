/**
 * Token-gated Levenshtein fuzzy matcher.
 *
 * History: an earlier version used a 0.65 similarity threshold combined with
 * a bare `includes(needle)` shortcut. Short queries ("lui") matched any
 * candidate that contained those letters in sequence, which made
 * resolveClient confuse names that share no actual word ("Luis Romero" vs
 * "Estefany Zulura"). The current version requires a real token overlap
 * before accepting a candidate.
 */

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!)
      prev = tmp
    }
  }
  return dp[b.length]!
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length, 1)
  return 1 - levenshtein(a, b) / max
}

export function tokens(s: string): string[] {
  return normalize(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2)
}

export function shareToken(queryTokens: string[], candidateTokens: string[]): boolean {
  for (const q of queryTokens) {
    for (const c of candidateTokens) {
      if (q === c) return true
      if (q.length >= 4 && c.startsWith(q)) return true
      if (c.length >= 4 && q.startsWith(c)) return true
    }
  }
  return false
}

export interface FuzzyMatch<T extends { name: string }> {
  status: 'found' | 'ambiguous' | 'not_found'
  match?: T
  candidates?: T[]
}

export const FUZZY_THRESHOLD     = 0.72
export const FUZZY_AMBIGUOUS_GAP = 0.10

/**
 * Two-tier match. A candidate qualifies if EITHER:
 *
 *   (a) An exact token of the query appears among the candidate's tokens —
 *       partial-name queries like "Gardi" against "Gardi Suárez" pass this
 *       gate regardless of overall string similarity. Levenshtein drops to
 *       ~0.42 for that pair because the candidate is much longer, which
 *       the previous threshold-only rule rejected even though the intent
 *       is obviously a match. Same reasoning for "Pérez" → "Pedro Pérez".
 *
 *   (b) A strong prefix overlap (≥4 chars in either direction). This
 *       recovers cases where the user said only part of a name and STT
 *       trimmed it ("lizet" → "Lizeth"). shareToken already encodes the
 *       conservative bar — adding a similarity threshold on top of it was
 *       redundant and rejected legitimate matches against longer
 *       candidates (similarity drops with candidate length).
 *
 * Anything that fails both gates is `not_found`. Recovering character-
 * level typos that don't share a token prefix (e.g. "perz" → "Pérez") is
 * intentionally NOT supported — that surface introduces cross-name false
 * positives at the levels STT produces.
 */
export function fuzzyFind<T extends { name: string }>(items: T[], query: string): FuzzyMatch<T> {
  if (!items.length) return { status: 'not_found' }
  const needle  = normalize(query)
  const qTokens = tokens(query)
  if (qTokens.length === 0) return { status: 'not_found' }

  const scored = items
    .map(item => {
      const cTokens = tokens(item.name)
      const cSet    = new Set(cTokens)
      return {
        item,
        score:           similarity(normalize(item.name), needle),
        tokens:          cTokens,
        exactTokenMatch: qTokens.some(q => cSet.has(q)),
      }
    })
    .filter(s => {
      if (s.exactTokenMatch) return true                          // tier (a)
      return shareToken(qTokens, s.tokens)                        // tier (b)
    })
    .sort((a, b) => {
      // Exact-token matches outrank similarity-only matches so a partial
      // first-name doesn't lose to an unrelated client with a higher score.
      if (a.exactTokenMatch !== b.exactTokenMatch) return a.exactTokenMatch ? -1 : 1
      return b.score - a.score
    })

  if (scored.length === 0) return { status: 'not_found' }
  if (scored.length === 1) return { status: 'found', match: scored[0]!.item }

  const [first, second] = scored
  // Two exact-token matches → ambiguous unless one clearly dominates the score.
  // "luis" with two "Luis ..." clients in the DB belongs here.
  if (first!.exactTokenMatch && second!.exactTokenMatch) {
    if (first!.score - second!.score >= FUZZY_AMBIGUOUS_GAP) {
      return { status: 'found', match: first!.item }
    }
    return { status: 'ambiguous', candidates: scored.slice(0, 5).map(s => s.item) }
  }
  // Mixed (one exact-token + similarity-only competitors) → exact-token wins.
  if (first!.exactTokenMatch && !second!.exactTokenMatch) {
    return { status: 'found', match: first!.item }
  }
  // Pure similarity-only matches → standard gap-based decision.
  if (first!.score - second!.score >= FUZZY_AMBIGUOUS_GAP) {
    return { status: 'found', match: first!.item }
  }
  return { status: 'ambiguous', candidates: scored.slice(0, 5).map(s => s.item) }
}
