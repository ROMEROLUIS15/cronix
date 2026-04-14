/**
 * ai-orchestrator.ts — Facade coordinating the AI decision/execution pipeline.
 *
 * Single responsibility:
 *   1. Load or create ConversationState
 *   2. Delegate to DecisionEngine to analyze input
 *   3. Delegate to ExecutionEngine to produce result
 *   4. Persist updated state
 *   5. Return AiOutput to the channel adapter
 *
 * This is the ONLY entry point channel adapters should call.
 * Never call DecisionEngine or ExecutionEngine directly from a channel.
 */

import type { AiInput, AiOutput } from './types'
import type { IStateManager } from './state-manager'
import type { IDecisionEngine } from './decision-engine'
import type { IExecutionEngine } from './execution-engine'
import { stateManager } from './state-manager'
import { DecisionEngine } from './decision-engine'
import { ExecutionEngine } from './execution-engine'

// ── Orchestrator ──────────────────────────────────────────────────────────────

export interface IAiOrchestrator {
  /**
   * Process a user input within the context of a conversation.
   *
   * This is the single entry point for all channel adapters.
   * It handles the full pipeline: state → decision → execution → persistence.
   */
  process(input: AiInput): Promise<AiOutput>

  /**
   * Reset the conversation state for a user.
   * Useful for logout, manual reset, or after a completed flow.
   */
  reset(userId: string, businessId: string): Promise<void>
}

export class AiOrchestrator implements IAiOrchestrator {
  constructor(
    private stateManager: IStateManager,
    private decisionEngine: IDecisionEngine,
    private executionEngine: IExecutionEngine,
  ) {}

  async process(input: AiInput): Promise<AiOutput> {
    // 1. Load or create conversation state
    let state = await this.stateManager.load(input.userId, input.businessId)
    if (!state) {
      state = this.stateManager.create({
        userId: input.userId,
        businessId: input.businessId,
        channel: input.channel,
      })
    }

    // 2. Increment turn counter
    this.stateManager.incrementTurn(state)

    // 3. Check if we should abort (turn limit exceeded)
    if (this.stateManager.shouldAbort(state)) {
      return {
        text: 'Llevamos varios intercambios sin poder completar la acción. Por favor, empieza de nuevo indicando qué necesitas.',
        actionPerformed: false,
        toolTrace: [],
        tokens: 0,
        state,
        history: input.history,
      }
    }

    // 4. Analyze input → produce decision
    const decision = this.decisionEngine.analyze(input, state)

    // 5. Execute decision → produce result
    const result = await this.executionEngine.execute(decision, state, input)

    // 6. Build updated history (append user message + assistant response)
    const updatedHistory = [
      ...input.history,
      { role: 'user' as const, content: input.text },
      { role: 'assistant' as const, content: result.text },
    ].slice(-8) // Cap at 8 messages

    // 7. Persist state
    await this.stateManager.persist(result.nextState)

    // 8. Return output
    return {
      text: result.text,
      actionPerformed: result.actionPerformed,
      toolTrace: result.toolTrace,
      tokens: result.tokens,
      state: result.nextState,
      history: updatedHistory,
    }
  }

  async reset(userId: string, businessId: string): Promise<void> {
    const state = await this.stateManager.load(userId, businessId)
    if (state) {
      this.stateManager.reset(state)
      await this.stateManager.persist(state)
    }
  }
}

// ── Default Instance ──────────────────────────────────────────────────────────
// Ready to use out of the box. Dependencies use mock implementations for
// Phase 1. Replace individual components as they are built in later phases.

export const orchestrator = new AiOrchestrator(
  stateManager,
  new DecisionEngine(),
  new ExecutionEngine(),
)
