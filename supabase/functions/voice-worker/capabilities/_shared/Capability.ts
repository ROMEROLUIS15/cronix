/**
 * Capability contract.
 *
 * A capability owns one user intent end-to-end: the deterministic detector
 * that pattern-matches the user's text, the schema the LLM uses when its own
 * routing wins, and the tool body that talks to the database.
 *
 * Three guarantees this interface enforces:
 *
 *   - `detectFastPath` is the only place fast-path regexes live. The agent
 *     loop never inspects user text directly anymore.
 *   - `execute` is the only place that touches the DB on behalf of this
 *     intent. There is no shared "tools.ts" god-file across capabilities.
 *   - `definition` is the only LLM-facing surface for this capability,
 *     keeping schema drift contained.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult } from '../../types.ts'
import type { SessionMessage, LastReferencedAppointment } from '../../core/session.ts'

export interface FastPathInput {
  /** Raw user text for the current turn. */
  text:    string
  /** Today's date in the business timezone, YYYY-MM-DD. */
  today:   string
  timezone: string
  /** Conversation history (already cascaded through Redis → client). */
  history: SessionMessage[]
  /** Most recent appointment the user/agent referenced, when fresh. */
  lastRef: LastReferencedAppointment | null
}

// Re-export so capabilities can import the canonical type from the shared module.
export type { LastReferencedAppointment } from '../../core/session.ts'

export interface ToolDefinition {
  type: 'function'
  function: {
    name:        string
    description: string
    parameters:  Record<string, unknown>
  }
}

export interface ICapability<Args extends Record<string, unknown> = Record<string, unknown>> {
  readonly name:       string
  readonly isWrite:    boolean
  /**
   * If true, the agent uses the tool's `result` string as the spoken
   * response when this capability succeeded as the sole tool call. All
   * current capabilities opt in — tool results are already prose.
   */
  readonly bypassLLM:  boolean
  readonly definition: ToolDefinition

  /** Returns args to pass to `execute`, or null when no fast path applies. */
  detectFastPath(input: FastPathInput): Args | null

  /** Executes the tool with already-validated args. */
  execute(ctx: ToolContext, args: Args): Promise<ToolResult>
}
