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

export function fuzzyFind<T extends { name: string }>(items: T[], query: string): FuzzyMatch<T> {
  if (!items.length) return { status: 'not_found' }
  const needle  = normalize(query)
  const qTokens = tokens(query)
  if (qTokens.length === 0) return { status: 'not_found' }

  const scored = items
    .map(item => ({
      item,
      score:  similarity(normalize(item.name), needle),
      tokens: tokens(item.name),
    }))
    .filter(s => s.score >= FUZZY_THRESHOLD && shareToken(qTokens, s.tokens))
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { status: 'not_found' }
  if (scored.length === 1) return { status: 'found', match: scored[0]!.item }

  const [first, second] = scored
  if (first!.score - second!.score >= FUZZY_AMBIGUOUS_GAP) {
    return { status: 'found', match: first!.item }
  }
  return { status: 'ambiguous', candidates: scored.slice(0, 5).map(s => s.item) }
}
