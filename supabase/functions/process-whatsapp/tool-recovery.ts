/**
 * tool-recovery.ts — Embedded <function> recovery (pure, no I/O).
 *
 * The 8B sometimes leaks a tool call as plain text instead of a real tool_call,
 * e.g. `<function=confirm_booking>{...}</function>`. When the confirmation gate
 * allows tools this turn, we promote that leaked text into a real tool_call;
 * otherwise we'd be executing exactly the hallucinations the gate blocks.
 *
 * Extracted from ai-agent.ts's runAgentLoop so the parsing/validation can be
 * unit-tested in isolation. The caller still owns the message mutation + loop
 * control (promote → set tool_calls, invalid → fallback + break).
 */

export type RecoverableToolName = 'confirm_booking' | 'reschedule_booking' | 'cancel_booking'

const VALID_TOOL_NAMES = new Set<string>(['confirm_booking', 'reschedule_booking', 'cancel_booking'])

export type EmbeddedRecovery =
  | { status: 'recovered'; name: RecoverableToolName; argsRaw: string }
  | { status: 'invalid';   name: string }
  | null

/**
 * Parses leaked `<function>` syntax from assistant text.
 *   - `null`                              → no embedded function found, proceed normally
 *   - `{ status: 'recovered', name, ... }`→ a valid booking tool call to promote
 *   - `{ status: 'invalid', name }`       → found syntax but bad JSON / unknown tool
 */
export function recoverEmbeddedToolCall(content: string): EmbeddedRecovery {
  const match1 = content.match(/<function=([a-z_]+)>([\s\S]*?)<\/function>/i)
  const match2 = content.match(/<function>\s*([a-z_]+)\s*<\/function>\s*(\{[\s\S]*\})/i)

  let fnName  = ''
  let argsRaw = ''
  if (match1)      { fnName = match1[1] ?? ''; argsRaw = match1[2] ?? '' }
  else if (match2) { fnName = match2[1] ?? ''; argsRaw = match2[2] ?? '' }

  if (!fnName) return null

  let argsValid = false
  try { JSON.parse(argsRaw); argsValid = true } catch { /* malformed JSON — not recoverable */ }

  if (argsValid && VALID_TOOL_NAMES.has(fnName)) {
    return { status: 'recovered', name: fnName as RecoverableToolName, argsRaw }
  }
  return { status: 'invalid', name: fnName }
}
