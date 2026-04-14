/**
 * orchestrator/index.ts — Barrel exports for the AI Orchestrator core.
 *
 * Phase 1 exports:
 *   - AiOrchestrator (facade)
 *   - DecisionEngine
 *   - ExecutionEngine
 *   - StateManager (interface + in-memory implementation)
 *   - Strategy system (interface + implementations)
 *   - All types
 *
 * Usage:
 *   import { orchestrator } from '@/lib/ai/orchestrator'
 *   import { AiOrchestrator, DecisionEngine, ExecutionEngine } from '@/lib/ai/orchestrator'
 *   import type { AiInput, AiOutput, ConversationState } from '@/lib/ai/orchestrator'
 */

// ── Core ──────────────────────────────────────────────────────────────────────
export { AiOrchestrator, orchestrator } from './ai-orchestrator'
export type { IAiOrchestrator } from './ai-orchestrator'

// ── Decision Engine ───────────────────────────────────────────────────────────
export { DecisionEngine } from './decision-engine'
export type { IDecisionEngine } from './decision-engine'

// ── Execution Engine ──────────────────────────────────────────────────────────
export { ExecutionEngine, MockToolExecutor, DefaultMockLlmProvider } from './execution-engine'
export type { IExecutionEngine, IToolExecutor, ToolExecuteParams, IMockLlmProvider, MockLlmResponse } from './execution-engine'

// ── State Manager ─────────────────────────────────────────────────────────────
export { InMemoryStateManager, stateManager } from './state-manager'
export type { IStateManager } from './state-manager'

// ── Strategy System ───────────────────────────────────────────────────────────
export {
  ExternalUserStrategy,
  OwnerStrategy,
  EmployeeStrategy,
  PlatformAdminStrategy,
  StrategyFactory,
} from './strategy'
export type { IUserStrategy } from './strategy'

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  UserRole,
  AiChannel,
  BusinessContext,
  AiInput,
  AiOutput,
  ConversationState,
  ConversationFlow,
  DraftPayload,
  Decision,
  ExecutionResult,
  ToolTrace,
} from './types'
