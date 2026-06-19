/**
 * confirmation-gate.ts — Deterministic 2-turn tool-gating for WhatsApp.
 *
 * The 8B model is prone to hallucinating tool args on the first user message.
 * We gate tool availability:
 *  - If the prior assistant turn was a "¿Confirmo…?" and the user answered
 *    affirmatively → allow tools (tool_choice: 'auto').
 *  - Otherwise → forbid tools (tool_choice: 'none') so the model must gather
 *    data and propose a confirmation before any booking action runs.
 *
 * Extracted from ai-agent.ts so it can be tested and reasoned about in isolation.
 */

// ── Patterns ──────────────────────────────────────────────────────────────────

const CONFIRMATION_QUESTION_RE =
  /¿\s*(Confirmo|Reagendo|Procedo|Te\s+(?:confirmo|agendo|reagendo)|Confirma[rs]?\s+(?:que\s+(?:(?:la|lo|se|las|los)\s+)?(?:cancele|reagende|agende)|la\s+cancelaci[óo]n|el\s+reagendamiento|la\s+reserva|la\s+cita))/i

// Boundary: whitespace, sentence punctuation, or end-of-string. We do NOT use \b
// because Spanish accents (í, á, ó) are not "word" chars in JS regex without /u,
// so \b after "sí" / "ajá" / "así es" fails — which made the gate ignore the most
// common Spanish affirmative ("sí"). Mirrors core/conversation/frame.ts.
const AFF_END = '(?:\\s|[.,!?]|$)'
const AFFIRMATIVE_RE = new RegExp(
  `^(s[íi]+p?|sii+|dale|ok(?:ay|is)?|oks|va+le?|vamos|confirm[oa](?:do|ar)?|list[oa]|clar[oa]|perfect[oa]|adelante|procede|proceda|por\\s+supuesto|as[íi]\\s+es|est[áa]\\s+bien|todo\\s+bien|me\\s+parece|correcto|exact[oa](?:mente)?|bien|bueno|buenas|genial|hecho|seguro|obvio|afirmativo|aj[áa]|de\\s+acuerdo|de\\s+una|dalee+|agenda(?:lo|r)?|reagenda(?:lo|r)?|cancela(?:lo|r)?|confirmado|confirmada|confirma)${AFF_END}`,
  'i',
)

const NEGATIVE_RE =
  /^(no+|nop[ea]?|nada|para\s+nada|todav[íi]a\s+no|a[úu]n\s+no|mejor\s+no|cancela\s+eso)\b/i

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the last assistant message in history was a confirmation
 * question (e.g. "¿Confirmo la cita?").
 */
export function lastAssistantWasConfirmation(
  history: ReadonlyArray<{ role: string; text: string }>,
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!h) continue
    if (h.role === 'model' || h.role === 'assistant') {
      return CONFIRMATION_QUESTION_RE.test(h.text ?? '')
    }
  }
  return false
}

/**
 * Returns true when the user message reads as a clear affirmative.
 * Normalises punctuation and rejects negations first.
 */
export function isAffirmative(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[.,!¡?¿]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 60) return false
  if (NEGATIVE_RE.test(t)) return false
  return AFFIRMATIVE_RE.test(t)
}

/**
 * Combined gate check — true when tools should be allowed this turn.
 */
export function toolsAllowedThisTurn(
  history:  { role: string; text: string }[],
  userText: string,
): boolean {
  return lastAssistantWasConfirmation(history) && isAffirmative(userText)
}

// ── Hybrid Gate: Direct Booking Params Detection ──────────────────────────────

/**
 * Returns true when the user message contains explicit date and time references
 * suitable for a direct booking tool call without a confirmation turn.
 *
 * Used by the Hybrid Gate in ai-agent.ts to bypass the 2-turn confirmation
 * gate when the user provides all explicit parameters in a single message.
 *
 * Checks for:
 *  - Date: "hoy", "mañana", "pasado mañana", ISO dates, DD/MM patterns
 *  - Time: HH:mm patterns, "a las/a la/para las/para la" + number
 */
export function textHasExplicitBookingParams(text: string): boolean {
  const t = text.toLowerCase()
  const hasDate = /\b(hoy|mañana|pasado\s+mañana|\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/i.test(t)
    || /\b\d{4}-\d{2}-\d{2}\b/.test(t)
    || /\b\d{1,2}\/\d{1,2}\b/.test(t)
  const hasTime = /\b\d{1,2}:\d{2}\b/.test(t)
    || /\b(a\s+las|a\s+la|para\s+las|para\s+la)\s+\d{1,2}\b/i.test(t)
  return hasDate && hasTime
}
