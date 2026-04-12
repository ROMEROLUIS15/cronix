/**
 * types.ts — Shared AI application layer types.
 *
 * Exposes: ExecutorResult, StepTrace
 * Used by: planner.ts, executor.ts, AssistantService
 *
 * Does NOT import from lib/ai/... to keep dependency direction clean.
 * (application layer knows domain, not infrastructure)
 */

/**
 * Trace of a single tool execution step.
 * Used for debugging and observability.
 */
export interface StepTrace {
  toolName:    string
  duration_ms: number
  success:     boolean
  rateLimited: boolean
  timedOut:    boolean
}

/**
 * Result of a full executor run (one or more tool calls).
 *
 * Individual tool failures are captured as error text in `toolMessages[].content`
 * so the LLM can reason about them. There is no top-level failure variant —
 * the executor is designed to always return tool results, even on partial errors.
 */
export interface ExecutorResult {
  /** Raw tool result messages — caller must push these back into LLM message history */
  toolMessages:    { tool_call_id: string; name: string; content: string }[]
  actionPerformed: true
  traces:          StepTrace[]
}
