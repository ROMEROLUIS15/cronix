/**
 * tool-adapter.ts — Maps LLM tool calls to domain use case execution.
 *
 * Each ToolAdapter:
 *   1. Receives raw LLM arguments (flat Record<string, unknown>)
 *   2. Extracts/merges data from ConversationState draft
 *   3. Validates with Zod schema
 *   4. Builds the use case input DTO
 *   5. Executes the use case
 *   6. Returns a structured result (success/failure with message)
 *
 * This replaces the old MockToolExecutor switch/case pattern.
 */

import type { z } from 'zod'
import type { Result } from '@/types/result'
import type { ConversationState } from '@/lib/ai/orchestrator/types'

// ── ToolAdapter Interface ────────────────────────────────────────────────────

export interface ToolExecuteResult {
  success: boolean
  message: string
  /** Parsed use case output (if any) — for downstream consumers */
  data?: unknown
}

export interface ToolAdapter<UseCaseInput, UseCaseOutput> {
  /** The tool name the LLM knows (must match tool definition name) */
  toolName: string

  /** Zod schema for validating LLM arguments after extraction */
  schema: z.ZodType<UseCaseInput>

  /**
   * Extract and merge arguments from LLM args + conversation state draft.
   *
   * The LLM may provide partial data. This function fills in the gaps
   * from the conversation state (e.g., clientName from a previous turn).
   */
  extract(args: Record<string, unknown>, state: ConversationState): Record<string, unknown>

  /**
   * Build the use case input DTO from validated args.
   */
  buildInput(validated: UseCaseInput): UseCaseInput

  /**
   * Execute the use case and return a structured result.
   *
   * The executor is a generic function that accepts any use case.
   * The ToolAdapter knows which use case to call.
   */
  executor: (input: UseCaseInput) => Promise<Result<UseCaseOutput>>

  /**
   * Format the use case output into a user-facing message.
   * On success: returns a confirmation message.
   * On failure: returns the error message from the Result.
   */
  formatSuccess(validated: UseCaseInput, output: UseCaseOutput): string
}

// ── Convenience type for any ToolAdapter ──────────────────────────────────────

export type AnyToolAdapter = ToolAdapter<Record<string, unknown>, unknown>

// ── Generic factory for creating ToolAdapters ─────────────────────────────────

export interface ToolAdapterConfig<UseCaseInput, UseCaseOutput> {
  toolName: string
  schema: z.ZodType<UseCaseInput>
  extract?: (args: Record<string, unknown>, state: ConversationState) => Record<string, unknown>
  buildInput?: (validated: UseCaseInput) => UseCaseInput
  executor: (input: UseCaseInput) => Promise<Result<UseCaseOutput>>
  formatSuccess: (validated: UseCaseInput, output: UseCaseOutput) => string
}

export function createToolAdapter<UseCaseInput extends Record<string, unknown>, UseCaseOutput>(
  config: ToolAdapterConfig<UseCaseInput, UseCaseOutput>,
): ToolAdapter<UseCaseInput, UseCaseOutput> {
  return {
    toolName: config.toolName,
    schema: config.schema,
    extract: config.extract ?? ((args) => args),
    buildInput: config.buildInput ?? ((v) => v),
    executor: config.executor,
    formatSuccess: config.formatSuccess,
  }
}
