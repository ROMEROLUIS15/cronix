/**
 * Maps a failed `ToolResult.error` to the `errorCode` recorded on the trace
 * tool-call (`ai_traces.tool_calls[].errorCode`).
 *
 * Codes that carry alerting meaning pass through untouched:
 *   - GUARD_REJECTED / REVIEWER_BLOCKED → safety mechanisms working (benign).
 *   - DB_ERROR                          → a Supabase call failed (real failure).
 * Anything else (clarification turns, validation, not-found) collapses to the
 * caller's generic fallback, which is NOT an alert signal.
 */

const PASS_THROUGH = new Set(['GUARD_REJECTED', 'REVIEWER_BLOCKED', 'DB_ERROR'])

export function toolErrorCode(error: string | undefined, fallback: string): string {
  return error !== undefined && PASS_THROUGH.has(error) ? error : fallback
}
