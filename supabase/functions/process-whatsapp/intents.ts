/**
 * intents.ts — Single source of truth for the agent's intent detection.
 *
 * Previously the regexes were duplicated in booking-flow.ts AND ai-agent.ts and
 * DIVERGED (one matched the enclitic "reagendarla", the other didn't) — exactly the
 * spaghetti the constitution §1.0 forbids. They now live here behind predicate
 * functions, so a change is made once and can never drift.
 *
 * Two robustness rules baked in:
 *  - Verb stems use \w* so enclitic/inflected forms match ("reagendarla", "cancélame").
 *  - Detection is ACCENT-INSENSITIVE: real users type accented imperatives
 *    ("reagéndala", "cancélala", "muévela", "bórrala") that a literal stem would miss.
 */

/** Lowercase + strip accents so accented imperatives match the plain stem. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Cancel an appointment: cancelar / anular / borrar (+ enclitics). */
const CANCEL_RE = /\b(cancel\w*|anul\w*|borr\w*)\b/

/**
 * "I can't make it" — the natural reply to the 20:00 reminder ("no podré asistir",
 * "no puedo ir", "no voy a poder"). Kept SEPARATE from CANCEL_RE on purpose: it only
 * routes the cancel branch for an EXISTING appointment (booking-flow (C)). Mid new-booking
 * or mid-reschedule, "ese día no puedo ir" means "not that slot", not "cancel" — those
 * sub-dialogues are resolved before (C) and never consult this predicate.
 * Matched on folded text (accents stripped): "podré" → "podre", "iré" → "ire".
 */
const ATTEND       = String.raw`(?:ir(?:me)?|asistir|acudir|llegar(?!\s+a\s+tiempo))`
const MODAL        = String.raw`(?:podre|podremos|puedo|podemos|voy\s+a\s+poder|vamos\s+a\s+poder)`
const GOING_TO     = String.raw`(?:voy|vamos)\s+a`
const FUTURE       = String.raw`(?:asistire|asistiremos|ire|iremos|acudire|llegare)`
// A bare modal closing the clause: "no podré, gracias", "no voy a poder."
const BARE_MODAL   = String.raw`(?:podre|podremos|voy\s+a\s+poder|vamos\s+a\s+poder)\s*(?:$|[,.;!?])`
const CANT_ATTEND_RE = new RegExp(
  String.raw`\bno\s+(?:${MODAL}\s+${ATTEND}\b|${GOING_TO}\s+${ATTEND}\b|${FUTURE}\b|${BARE_MODAL})`,
)

/**
 * Reschedule TRIGGER (loose) — used to ROUTE a turn into the reschedule resolver.
 * Includes "mover/mueve/cambiar" because, at routing time, those plausibly mean
 * "reschedule". NOT used to EXIT the new-booking sub-dialogue (see isManageExisting),
 * where mid-booking "cambia/mover" instead means "change the current proposal".
 */
// `mover\w*`/`muev\w*` catch enclitics ("moverla", "muévela") without matching the
// noun "móvil" (folds to "movil" — neither stem reaches it).
const RESCHEDULE_RE = /\b(reagend\w*|reprogram\w*|mover\w*|muev\w*|cambi\w*)\b/

/**
 * "Manage an EXISTING appointment" — cancel or reschedule, STRICT verbs only. Used to
 * exit new-booking context. Deliberately omits the ambiguous "cambia/mover".
 */
const MANAGE_EXISTING_RE = /\b(cancel\w*|anul\w*|reagend\w*|reprogram\w*)\b/

/**
 * Fresh new-booking intent. `\bagend` does NOT match "reagendar" (no word boundary),
 * so a reschedule is never mistaken for a new booking.
 */
const BOOK_INTENT_RE =
  /\b(agend(?:a|ar|ame|alo|emos|o)?|reserv(?:a|ar|ame|o)?|(?:quiero|necesito|sacar|pedir|dame|hacer)\s+(?:una\s+)?cita|nueva\s+cita)\b/

export const isCancelIntent     = (text: string): boolean => CANCEL_RE.test(fold(text))
export const isCantAttendIntent = (text: string): boolean => CANT_ATTEND_RE.test(fold(text).trim())
export const isRescheduleIntent = (text: string): boolean => RESCHEDULE_RE.test(fold(text))
export const isManageExisting   = (text: string): boolean => MANAGE_EXISTING_RE.test(fold(text))
export const isBookIntent       = (text: string): boolean => BOOK_INTENT_RE.test(fold(text))
