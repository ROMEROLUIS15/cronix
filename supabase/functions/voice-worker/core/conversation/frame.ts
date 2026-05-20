/**
 * Conversation frame — defines the window of recent user turns that
 * anti-hallucination guards may treat as "things the user actually said."
 *
 * A frame OPENS on the first user turn and CLOSES on a terminal assistant
 * message (successful write, definitive failure, or pure listing). Question-
 * style assistant turns ("¿Para qué servicio?") leave the frame open so
 * multi-turn slot collection works.
 *
 * Why this exists as a module:
 *   - Multi-turn schedule loops are sensitive to where the boundary lands.
 *     The previous heuristic "close on any assistant turn without ?" caused
 *     mid-flow confirmation statements ("Perfecto, te confirmo: 21 de mayo
 *     a las 3pm") to truncate the corpus, losing slots given two turns back.
 *   - The opposite heuristic "close only on 'Listo.'" leaks tokens from a
 *     prior failed intent into the next attempt.
 *
 * The terminal-marker rule below threads the needle: close on explicit
 * outcomes (success or definitive error), keep the frame open for everything
 * else.
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

const CORPUS_MAX_CHARS = 4000

// Boundary after the trigger phrase is either whitespace, end-of-string, or
// punctuation. We do NOT use \b — Spanish accents (é, á, ó) are not "word"
// chars in JS regex without the /u flag, so \b after "encontré" fails.
const END = '(?:\\s|[.,!?]|$)'

const TERMINAL_PATTERNS: readonly RegExp[] = [
  new RegExp(`^\\s*Listo${END}`,        'i'),
  new RegExp(`^\\s*Cancelado${END}`,    'i'),
  new RegExp(`^\\s*Reagendado${END}`,   'i'),
  new RegExp(`^\\s*Agendado${END}`,     'i'),
  new RegExp(`^\\s*No encontr[ée]${END}`, 'i'),
  new RegExp(`^\\s*No pude${END}`,      'i'),
  new RegExp(`^\\s*No hay${END}`,       'i'),
  /ya est[áa] ocupado/i,
]

export function isTerminalAssistantMessage(content: string): boolean {
  if (!content) return false
  if (/[?¿]/.test(content)) return false
  return TERMINAL_PATTERNS.some(re => re.test(content))
}

/**
 * Returns the index in `history` of the last terminal assistant message, or
 * -1 when none. Callers slice the history from `index + 1` onward to get the
 * "current frame".
 */
export function findLastFrameBoundary(history: readonly ChatTurn[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg && msg.role === 'assistant' && isTerminalAssistantMessage(msg.content)) {
      return i
    }
  }
  return -1
}

/**
 * Builds the concatenated user corpus for the current frame: the new input
 * plus every prior user turn since the last frame boundary. Capped at
 * `CORPUS_MAX_CHARS` to keep regex passes bounded.
 */
export function buildUserCorpus(
  inputText: string,
  history:   readonly ChatTurn[],
): { corpus: string; cutoff: number; relevantTurns: number } {
  const cutoff = findLastFrameBoundary(history)
  const relevantHistory = history.slice(cutoff + 1)
  const parts: string[] = [inputText]
  for (const m of relevantHistory) {
    if (m.role === 'user') parts.push(m.content)
  }
  const corpus = parts.join(' ').slice(0, CORPUS_MAX_CHARS)
  return { corpus, cutoff, relevantTurns: relevantHistory.length }
}
