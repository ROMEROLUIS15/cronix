/**
 * Coerces parsed LLM tool-call arguments to a plain object.
 *
 * Llama 3.3 emits `arguments: "null"` (and occasionally "[]") for no-param
 * tools like get_services. JSON.parse passes those through, but a null/array/
 * primitive value then crashes buildToolFingerprint's Object.keys() with an
 * uncaught TypeError — which used to take down the whole turn (HTTP 500 /
 * LLM_EXCEPTION). Anything that isn't a plain object becomes {} so the tool
 * still runs with empty args.
 */
export function coerceToolArgs(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
}

/**
 * Drops every arg the tool's JSON Schema doesn't declare. The LLM boundary
 * is the only caller — fast-path detectors invoke tools directly and may
 * pass internal-only args (e.g. `appointment_id` resolved from lastRef).
 *
 * Without this, a hallucinated `appointment_id` on cancel/reschedule routed
 * the tool into its anaphoric branch, skipping the mention guard and client
 * resolution entirely. The model never legitimately knows IDs (results are
 * prose, the prompt forbids them), so any undeclared key is noise or worse.
 */
export function stripUndeclaredArgs(
  args:     Record<string, unknown>,
  declared: ReadonlySet<string>,
): { args: Record<string, unknown>; dropped: string[] } {
  const dropped = Object.keys(args).filter(k => !declared.has(k))
  if (dropped.length === 0) return { args, dropped }
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (declared.has(k)) clean[k] = v
  }
  return { args: clean, dropped }
}
