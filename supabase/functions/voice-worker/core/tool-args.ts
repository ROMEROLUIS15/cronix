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
