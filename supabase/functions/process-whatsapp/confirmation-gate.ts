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

const AFFIRMATIVE_RE =
  /^(s[íi]+p?|sii+|dale|ok(?:ay|is)?|oks|va+le?|vamos|confirm[oa](?:do|ar)?|list[oa]|clar[oa]|perfect[oa]|adelante|procede|proceda|por\s+supuesto|as[íi]\s+es|est[áa]\s+bien|todo\s+bien|me\s+parece|correcto|exact[oa](?:mente)?|bien|bueno|buenas|genial|hecho|seguro|obvio|afirmativo|aj[áa]|de\s+acuerdo|de\s+una|dalee+|agenda(?:lo|r)?|reagenda(?:lo|r)?|cancela(?:lo|r)?|confirmado|confirmada|confirma)\b/i

const NEGATIVE_RE =
  /^(no+|nop[ea]?|nada|para\s+nada|todav[íi]a\s+no|a[úu]n\s+no|mejor\s+no|cancela\s+eso)\b/i

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the last assistant message in history was a confirmation
 * question (e.g. "¿Confirmo la cita?").
 */
export function lastAssistantWasConfirmation(
  history: { role: string; text: string }[],
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
