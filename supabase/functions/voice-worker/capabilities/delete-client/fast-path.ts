/**
 * delete_client fast path. Four input shapes:
 *
 *   A) Explicit + phone:    "elimina a X con teléfono Y"
 *   B) Explicit + consent:  "elimina a X cualquiera|uno|los duplicados"
 *   C) Anaphoric verb:      "borra al duplicado", "elimina los duplicados",
 *                           "borra uno / el otro / cualquiera"
 *                           — verb present, name comes from history.
 *   D) Anaphoric reply:     "sí" / "sí, hazlo" / "el primero" /
 *                           "el de teléfono X" / "el otro"
 *                           — no verb. Only valid when the previous assistant
 *                           turn was a deletion-consent question.
 *
 * Shape D is the C8 strengthening: when the assistant asks "¿Elimino uno y
 * dejo el otro?" and the user says just "sí" or "el primero", we still want
 * the delete to fire deterministically instead of bouncing through the LLM.
 *
 * The history check is restrictive on purpose: a bare "sí" should only
 * trigger delete when the assistant's last non-question turn (or the last
 * assistant turn at all) was clearly a deletion prompt. We pattern-match the
 * exact strings deleteClient emits.
 */

import type { SessionMessage } from '../../core/session.ts'

export interface DeleteClientFastPathArgs extends Record<string, unknown> {
  client_name:    string
  any_duplicate?: boolean
  phone?:         string
}

// Verb roots covering elimina/eliminame/borra/borrame/quita/quitame/remueve.
const VERB = /(?:elim[íi]nam?e?|b[óo]rrame?|borra|qu[íi]tame?|quita|rem[ueú]ve)/

// (A) Phone variant: "elimina a X con teléfono 04XX..."
const PHONE_RE = new RegExp(
  `\\b${VERB.source}\\s+(?:al?\\s+)?(?:la\\s+)?(?:client[ea]\\s+)?([a-záéíóúñ][a-záéíóúñ\\s.'-]{1,80}?)\\s+(?:con\\s+(?:el\\s+)?|de(?:l)?\\s+|que\\s+tiene\\s+(?:el\\s+)?)tel[eé]fono\\s+([\\d\\s+()-]{6,30})\\s*\\??$`,
  'i',
)

// (B) "any duplicate" with explicit name.
const ANY_RE = new RegExp(
  `\\b${VERB.source}\\s+(?:al?\\s+)?(?:la\\s+)?(?:client[ea]\\s+)?([a-záéíóúñ][a-záéíóúñ\\s.'-]{1,80}?)\\s+(?:a\\s+)?(?:cualquiera(?:\\s+de\\s+(?:los|las)\\s+(?:dos|tres))?|alguno|a?\\s*uno|los\\s+duplicados|el\\s+duplicado)\\b`,
  'i',
)

// (C) Anaphoric verb form — no name in current turn.
//
// Accepts the determiner/preposition prefix in any of its natural forms:
//   "elimina el primero", "elimina al primero", "elimina primero",
//   "elimina la primera", "elimina a la primera", "elimina al otro",
//   "elimina uno", "elimina al duplicado", "elimina los duplicados".
//
// Previous version only matched "el primero" / "la primera" literally and
// missed the very common Spanish form "al primero" (a + el contraction).
const SHORT_VERB_RE = new RegExp(
  `^(?:s[ií],?\\s+)?${VERB.source}\\s+(?:a\\s+la\\s+|a\\s+los\\s+|a\\s+las\\s+|al\\s+|a\\s+|el\\s+|la\\s+|los\\s+|las\\s+)?(?:duplicados?|otros?|otra|uno|una|alguno|cualquiera(?:\\s+de\\s+(?:los|las)\\s+(?:dos|tres))?|primer[oa]|segund[oa]|tercer[oa])\\s*\\.?\\??$`,
  'i',
)

// (D) Confirmation-only replies (no verb).
//
// Matches the universe of consent phrases the user might utter after the
// assistant asked the deletion question:
//   - "sí" / "sí, hazlo" / "sí por favor" / "claro" / "dale" / "ok"
//   - "el primero" / "el segundo" / "la primera" / "el otro" / "cualquiera"
//   - "el de teléfono 04XX..." (with phone)
//
// All of these are short (≤ ~30 chars after normalisation) so we anchor to
// start AND end of the trimmed input — a long sentence that happens to
// contain "sí" should NOT trigger.
const REPLY_CONSENT_RE = /^(?:s[ií](?:[.,]?\s*(?:hazlo|por\s+favor|claro|dale|ok|seguro|adelante))?|claro|dale|ok|de\s+acuerdo|adelante)\s*\.?\??$/i
const REPLY_PICK_RE    = /^(?:el|la)\s+(?:primer[oa]|segund[oa]|tercer[oa]|otr[oa]|de\s+los\s+dos|de\s+las\s+dos|que\s+quieras|que\s+sea|cualquier[ao])\s*\.?\??$/i
const REPLY_PICK_ALT_RE = /^cualquier[ao]\s*\.?\??$/i
const REPLY_PHONE_RE   = /^(?:el|la)\s+de(?:l)?\s+tel[eé]fono\s+([\d\s+()-]{6,30})\s*\.?\??$/i

/**
 * Pulls the most recently-mentioned client name out of the assistant history.
 * Matches the response shapes deleteClient and searchClients emit:
 *
 *   - "Tengo N clientes con nombre similar a X."
 *   - "Tengo N clientes llamados X con el mismo..."
 *   - "Sí, X está entre tus clientes..."
 *   - "Hay varios clientes llamados X: ..."
 */
export function extractRecentClientNameFromHistory(
  history: SessionMessage[],
): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!
    if (msg.role !== 'assistant') continue
    const t = msg.content

    let m = t.match(/clientes\s+(?:con\s+nombre\s+similar\s+a|llamad[oa]s?)\s+([a-záéíóúñ][a-záéíóúñ\s.'-]{1,60}?)(?:\s+(?:con|sin|y|que|en)\b|\s*[.,:!?])/i)
    if (m && m[1]) return m[1].trim().replace(/[.,;:!?]+$/, '').trim()

    m = t.match(/s[ií],?\s+([a-záéíóúñ][a-záéíóúñ\s.'-]{1,60}?)\s+est[áa]\s+entre\s+tus\s+clientes/i)
    if (m && m[1]) return m[1].trim().replace(/[.,;:!?]+$/, '').trim()

    m = t.match(/(?:hay|tengo)\s+\d+\s+clientes?\s+(?:con\s+nombre\s+similar\s+a|llamad[oa]s?)\s+([a-záéíóúñ][a-záéíóúñ\s.'-]{1,60}?)(?:\s+(?:con|sin|y|que|en)\b|\s*[.,:!?])/i)
    if (m && m[1]) return m[1].trim().replace(/[.,;:!?]+$/, '').trim()
  }
  return null
}

/**
 * Returns true when the most recent assistant turn was the deletion-consent
 * question. We need this gate for shape (D): a bare "sí" should NOT trigger
 * delete when the assistant just asked something unrelated.
 *
 * The deletion-consent question deleteClient emits is exactly:
 *   "Tengo N clientes llamados X ... — parecen duplicados. ¿Elimino uno y dejo el otro?"
 *   "Hay varios clientes llamados X: ... ¿Cuál elimino, dime el teléfono?"
 */
function lastAssistantWasDeletionPrompt(history: SessionMessage[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!
    if (msg.role !== 'assistant') continue
    const t = msg.content.toLowerCase()
    return /elimino\s+uno\s+y\s+dejo\s+el\s+otro/.test(t)
        || /parecen\s+duplicados/.test(t)
        || /cu[aá]l\s+elimino/.test(t)
  }
  return false
}

export function detectDeleteClient(
  text:    string,
  history: SessionMessage[],
): DeleteClientFastPathArgs | null {
  const t = text.toLowerCase().trim()

  // (A) Phone variant
  const phoneMatch = t.match(PHONE_RE)
  if (phoneMatch && phoneMatch[1]) {
    return {
      client_name: phoneMatch[1].trim().replace(/[.,;:!?]+$/, '').trim(),
      phone:       phoneMatch[2]!.trim(),
    }
  }

  // (B) "any duplicate" with explicit name
  const anyMatch = t.match(ANY_RE)
  if (anyMatch && anyMatch[1]) {
    return {
      client_name:   anyMatch[1].trim().replace(/[.,;:!?]+$/, '').trim(),
      any_duplicate: true,
    }
  }

  // (C) Anaphoric verb form
  if (SHORT_VERB_RE.test(t)) {
    const name = extractRecentClientNameFromHistory(history)
    if (name) return { client_name: name, any_duplicate: true }
    return null
  }

  // (D) Confirmation-only replies — only valid right after a deletion prompt
  if (!lastAssistantWasDeletionPrompt(history)) return null

  const name = extractRecentClientNameFromHistory(history)
  if (!name) return null

  if (REPLY_CONSENT_RE.test(t) || REPLY_PICK_RE.test(t) || REPLY_PICK_ALT_RE.test(t)) {
    return { client_name: name, any_duplicate: true }
  }

  const phoneReply = t.match(REPLY_PHONE_RE)
  if (phoneReply && phoneReply[1]) {
    return { client_name: name, phone: phoneReply[1].trim() }
  }

  return null
}
