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

/**
 * Spanish phonetic skeleton for an already-normalised token. Collapses the
 * orthographic and STT variations that map to the same spoken name so the
 * resolver treats them as equivalent:
 *
 *   z / c(before e,i)  → s     (Lizet / Lisset / Licet → liset)
 *   silent h           → Ø     (Lisseth / Liseth      → liset)
 *   v                  → b     (Vázquez / Bázquez     → baskes)
 *   ll                 → y     (Yolanda / Llolanda    → yolanda)
 *   qu                 → k     (Vázquez               → baskes)
 *   double letters     → single (Lisseth → liseth → liset)
 *
 * Order matters: drop `h` first (otherwise "ch" survives), do `c(e|i)→s`
 * BEFORE `c→k` would mis-route (we keep `c` outside e/i untouched), and
 * collapse doubles last so per-letter rewrites can land double consonants
 * first.
 *
 * Intentionally NOT bridged:
 *   - c before a/o/u stays as c (Cardi ≠ Sardi — different names)
 *   - trailing -t is preserved (otherwise Pat/Pa would collide)
 *   - rr stays distinct from r (Pera vs Perra are different words)
 */
export function phoneticKey(token: string): string {
  let s = token.toLowerCase()
  s = s.replace(/h/g, '')
  s = s.replace(/c([ei])/g, 's$1')
  s = s.replace(/z/g, 's')
  s = s.replace(/v/g, 'b')
  s = s.replace(/ll/g, 'y')
  s = s.replace(/qu/g, 'k')
  s = s.replace(/(.)\1+/g, '$1')
  return s
}

/**
 * True when two tokens share a stem, either literally or phonetically:
 *
 *   1. literal equality                                  ("luis" === "luis")
 *   2. ≥4-char prefix overlap (either direction)         ("lui" → "luis")
 *   3. phonetic-key equality                             ("lisset" ↔ "lizet")
 *   4. ≥4-char phonetic-prefix overlap (either direction) ("lise"  → "lizet")
 *
 * The 4-char floor protects against short overlaps bridging unrelated names
 * ("ana" vs "anastasia" — `shareToken` says yes; "an" alone — says no).
 *
 * Deliberately NOT bridged (these are DIFFERENT names, even if they sound
 * close): Liset/Lizet/Liceth/Lisset/Lizeth ↔ Lisbeth/Lizbeth. The 'b' in
 * Lisbeth is part of the name's identity in the customer database; treating
 * the two as the same would let a user searching "Lizeth" delete or query
 * the wrong client. Precise client lookup is more important than tolerating
 * one extra dictation variant.
 */
export function shareToken(queryTokens: string[], candidateTokens: string[]): boolean {
  for (const q of queryTokens) {
    const qPhon = phoneticKey(q)
    for (const c of candidateTokens) {
      if (q === c) return true
      if (q.length >= 4 && c.startsWith(q)) return true
      if (c.length >= 4 && q.startsWith(c)) return true
      const cPhon = phoneticKey(c)
      if (qPhon === cPhon) return true
      if (qPhon.length >= 4 && cPhon.startsWith(qPhon)) return true
      if (cPhon.length >= 4 && qPhon.startsWith(cPhon)) return true
    }
  }
  return false
}

/**
 * True when any query token matches any candidate token either literally or
 * via its phonetic key. Used by fuzzyFind to flag "exact-token" tier: a
 * phonetic spelling collision deserves the same priority as a literal
 * collision, otherwise "Lisset" against "Lizet Pérez" falls into the lower
 * similarity-only tier and loses to coincidental neighbours.
 */
function hasExactOrPhoneticTokenMatch(
  queryTokens: string[],
  candidateSet: Set<string>,
  candidatePhoneticSet: Set<string>,
): boolean {
  for (const q of queryTokens) {
    if (candidateSet.has(q)) return true
    if (candidatePhoneticSet.has(phoneticKey(q))) return true
  }
  return false
}

export interface FuzzyMatch<T extends { name: string }> {
  status: 'found' | 'ambiguous' | 'not_found'
  match?: T
  candidates?: T[]
  /**
   * Confidence of the top match in [0, 1]. Used by write-tools to decide
   * whether to act or ask the user to confirm. An exact-token (literal or
   * phonetic) match is floored at 0.90 — even if the candidate string is
   * much longer than the query, the user clearly named a registered token.
   * A similarity-only match returns the raw normalised similarity.
   */
  confidence?: number
  /**
   * Gap between the top and second-best candidate's similarity. Lets callers
   * detect borderline matches even when status is 'found'.
   */
  gap?: number
}

export const FUZZY_THRESHOLD     = 0.72
export const FUZZY_AMBIGUOUS_GAP = 0.10

/**
 * Confidence floor for matches that hit the exact-token tier. The actual
 * similarity for "Luis" → "Luis Romero" is ~0.42 because of length asymmetry,
 * yet the user clearly named that client. Floor the confidence to 0.90 so
 * downstream write-tools (delete, schedule, cancel, reschedule) treat
 * exact-token hits as high-confidence even when raw similarity is low.
 */
export const FUZZY_EXACT_TOKEN_CONFIDENCE = 0.90

/**
 * Minimum confidence a destructive / write capability requires before acting
 * without a confirmation prompt. Below this, the tool surfaces the candidate
 * list and asks the user to disambiguate. Reads (last-visit, list-appointments,
 * search-clients) intentionally do not gate on this — they may be wrong but
 * are never destructive, and forcing a confirmation on every soft query would
 * destroy the agent's UX.
 */
export const WRITE_CONFIDENCE_THRESHOLD = 0.80

function computeConfidence(top: { score: number; exactTokenMatch: boolean }): number {
  return top.exactTokenMatch
    ? Math.max(top.score, FUZZY_EXACT_TOKEN_CONFIDENCE)
    : top.score
}

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
      const cPhonSet = new Set(cTokens.map(phoneticKey))
      return {
        item,
        score:           similarity(normalize(item.name), needle),
        tokens:          cTokens,
        exactTokenMatch: hasExactOrPhoneticTokenMatch(qTokens, cSet, cPhonSet),
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
  // Always surface the top-5 candidates so write-tools can confirm with the
  // user when confidence is borderline. The match field still designates the
  // primary pick for 'found'; candidates is purely informational there.
  const topCandidates = scored.slice(0, 5).map(s => s.item)
  if (scored.length === 1) {
    return {
      status:     'found',
      match:      scored[0]!.item,
      candidates: topCandidates,
      confidence: computeConfidence(scored[0]!),
      gap:        1, // no competitor — treat as maximally separated
    }
  }

  const [first, second] = scored
  const gap        = first!.score - second!.score
  const confidence = computeConfidence(first!)

  // Two exact-token matches → ambiguous unless one clearly dominates the score.
  // "luis" with two "Luis ..." clients in the DB belongs here.
  if (first!.exactTokenMatch && second!.exactTokenMatch) {
    if (gap >= FUZZY_AMBIGUOUS_GAP) {
      return { status: 'found', match: first!.item, candidates: topCandidates, confidence, gap }
    }
    return { status: 'ambiguous', candidates: topCandidates, confidence, gap }
  }
  // Mixed (one exact-token + similarity-only competitors) → exact-token wins.
  if (first!.exactTokenMatch && !second!.exactTokenMatch) {
    return { status: 'found', match: first!.item, candidates: topCandidates, confidence, gap }
  }
  // Pure similarity-only matches → standard gap-based decision.
  if (gap >= FUZZY_AMBIGUOUS_GAP) {
    return { status: 'found', match: first!.item, candidates: topCandidates, confidence, gap }
  }
  return { status: 'ambiguous', candidates: topCandidates, confidence, gap }
}
