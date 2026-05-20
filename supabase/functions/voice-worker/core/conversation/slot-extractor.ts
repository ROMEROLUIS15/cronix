/**
 * Deterministic extraction of booking slots from the in-frame user corpus.
 *
 * Write capabilities (schedule, reschedule) call these helpers to recover
 * slots when the LLM drops them across turns. The LLM is unreliable at
 * carrying values forward in Spanish — Llama 70B will routinely omit `time`
 * after asking the user a follow-up about the service — but the user did say
 * the hour two turns back. Parsing the corpus closes that gap.
 *
 * The "mention" guards exist because the model also fabricates names and
 * services that the user never uttered. If a value can't be traced to the
 * corpus, the capability refuses to act on it.
 */

import { parseDateExpression } from '../date-parser.ts'
import { parseTimeExpression, userMentionedTime } from '../time-parser.ts'
import { normalize, tokens }    from '../fuzzy.ts'

export interface CorpusSlots {
  date: string | null
  time: string | null
}

export function extractSlotsFromCorpus(corpus: string, todayLocal: string): CorpusSlots {
  return {
    date: parseDateExpression(corpus, todayLocal)?.date ?? null,
    time: parseTimeExpression(corpus)?.time ?? null,
  }
}

/**
 * True when ANY token of `name` (≥3 chars) appears in the normalized corpus.
 * Catches name fabrications without rejecting fuzzy/STT-mangled mentions.
 */
export function nameMentionedInCorpus(corpus: string, name: string): boolean {
  if (!name) return false
  const normalized = normalize(corpus)
  const ts = tokens(name)
  if (ts.length === 0) return false
  return ts.some(t => t.length >= 3 && normalized.includes(t))
}

export function timeMentionedInCorpus(corpus: string): boolean {
  return userMentionedTime(corpus)
}

export function dateMentionedInCorpus(corpus: string, todayLocal: string): boolean {
  return parseDateExpression(corpus, todayLocal) !== null
}
