/**
 * IAgent.ts — Contract every AI agent must fulfill.
 *
 * The DecisionEngine depends on this interface, never on a concrete agent.
 * To add a new channel (Telegram, Instagram, …) create a file that
 * satisfies IAgent and register it in orchestrator-factory.ts — zero
 * modifications to the orchestrator core required.
 */

import type { AiInput, ConversationState, ConversationFlow } from '../orchestrator/types'
import type { IUserStrategy } from '../orchestrator/strategy'

// ── Shared value types ────────────────────────────────────────────────────────

/**
 * Entities resolved before the LLM receives the system prompt.
 * Passed back by the decision engine so the prompt can say
 * "ya resuelto: date=…" instead of asking the LLM to re-derive them.
 */
export interface ResolvedEntities {
  date?:        string
  time?:        string
  clientName?:  string
  serviceName?: string
}

/** JSON-Schema tool definition as sent to the LLM (OpenAI/Groq format). */
export type ToolDefEntry = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; enum?: string[] }>
      required: string[]
      additionalProperties: false
    }
  }
}

/** Per-agent runtime configuration. */
export interface AgentConfig {
  /** Max ReAct iterations before forcing a fallback response. */
  maxReactIterations: number
  /** LLM quality tier for this agent's reasoning loop. */
  llmTier?: 'fast' | 'quality'
}

// ── Interface ─────────────────────────────────────────────────────────────────

/**
 * Every agent must implement this interface.
 *
 * The DecisionEngine receives an IAgent at construction time and calls
 * these methods at runtime — it never imports agent-specific modules directly.
 */
export interface IAgent {
  /**
   * Build the system prompt for a given request + conversation state.
   * Called once per turn, immediately before the LLM receives messages.
   */
  buildSystemPrompt(
    input:    AiInput,
    state:    ConversationState,
    resolved?: ResolvedEntities,
  ): string

  /**
   * Return tool definitions available for this turn, filtered by:
   *   1. Role strategy (what the user is allowed to do)
   *   2. Conversation flow (state-machine restriction)
   */
  buildToolDefs(
    strategy: IUserStrategy,
    flow:     ConversationFlow,
  ): ToolDefEntry[]

  /** Agent-level configuration (iterations, model tier, etc.). */
  readonly config: AgentConfig
}
