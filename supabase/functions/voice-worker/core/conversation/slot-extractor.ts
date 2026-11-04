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
import { tokens, shareToken }  from '../fuzzy.ts'

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
 * Connector/article tokens inside multi-word names ("Corte de cabello",
 * "María de los Ángeles"). They appear in almost any Spanish utterance, so
 * matching on them would let a fabricated name pass the guard via its "de".
 * If the name is ONLY connectors, fall back to all tokens — better a noisy
 * match than rejecting a client genuinely named that way.
 */
const NAME_CONNECTOR_TOKENS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'le', 'y', 'con', 'para', 'por',
])

/**
 * True when any meaningful token of `name` matches a token of the corpus —
 * literally, phonetically, or by ≥4-char prefix (shareToken, same bridging
 * the fuzzy resolver uses). Token-boundary matching, NOT substring:
 * the previous `corpus.includes(token)` let "Ana" pass whenever the user
 * said "mañana" (normalized "manana" contains "ana"), and names whose
 * tokens were all <3 chars could never pass at all.
 */
export function nameMentionedInCorpus(corpus: string, name: string): boolean {
  if (!name) return false
  const allNameTokens = tokens(name)
  if (allNameTokens.length === 0) return false
  const meaningful = allNameTokens.filter(t => !NAME_CONNECTOR_TOKENS.has(t))
  const nameTokens = meaningful.length > 0 ? meaningful : allNameTokens
  const corpusTokens = tokens(corpus)
  if (corpusTokens.length === 0) return false
  return shareToken(nameTokens, corpusTokens)
}

export function timeMentionedInCorpus(corpus: string): boolean {
  return userMentionedTime(corpus)
}

/**
 * Date and time the user gave for this order: this turn first, then the earlier turns of the same
 * order. An earlier question's date is not in `slotCorpus` (frame.ts).
 */
export function slotsForOrder(
  ctx: { userTurn?: string; slotCorpus?: string; userTextCorpus?: string }, todayLocal: string,
): { date: string | null; time: string | null } {
  const turn = extractSlotsFromCorpus(ctx.userTurn ?? '', todayLocal)
  const order = extractSlotsFromCorpus(ctx.slotCorpus ?? ctx.userTextCorpus ?? '', todayLocal)
  return { date: turn.date ?? order.date, time: turn.time ?? order.time }
}

const CHANGE_VERB = /\b(?:cambi|muev|mover|reagend|reprogram|adelant|atras)\w*|\bre\s+agend\w*/
const BOOKING_VERB = /\b(?:agend|reserv|program|apart|anot|crea)\w*/
const NEW_APPOINTMENT = /\b(?:una|otra|nueva)\s+cita\b|\bcita\s+nueva\b/
const EXISTING_APPOINTMENT = /\b(?:la|esa|esta|mi|su)\s+cita\b/

/**
 * True when this turn points at an appointment that already exists, so it must not create one.
 * A misheard verb can leave "la cita de Ana para las 4", which meant to move it. Takes the
 * current turn only: an earlier "qué tengo agendado" says nothing about this one.
 */
export function refersToExistingAppointment(turn: string): boolean {
  const text = turn.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (CHANGE_VERB.test(text)) return true
  if (BOOKING_VERB.test(text) || NEW_APPOINTMENT.test(text)) return false
  return EXISTING_APPOINTMENT.test(text)
}

export function dateMentionedInCorpus(corpus: string, todayLocal: string): boolean {
  return parseDateExpression(corpus, todayLocal) !== null
}
