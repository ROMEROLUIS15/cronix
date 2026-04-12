/**
 * planner.ts — LLM Planner for the ReAct loop.
 *
 * Exposes: runReActLoop()
 * Does not expose: tool execution, rate limiting, or session logic.
 * Guarantees: only produces AiCommand[] from LLM — never executes.
 *
 * Single Responsibility: decides WHAT to do. The executor decides HOW.
 */

import type { ILlmProvider, LlmMessage, ToolCall, ToolSchema } from '@/lib/ai/providers/types'
import { logger } from '@/lib/logger'

const MAX_STEPS = 3

export type AiCommand = {
  toolName:  string
  toolCallId: string
  args:       Record<string, unknown>
}

export type PlannerResult =
  | { type: 'text';     text:     string;        steps: number }
  | { type: 'commands'; commands: AiCommand[];   steps: number; messages: LlmMessage[] }
  | { type: 'error';    text:     string;        steps: number; loopExhausted: boolean }

/**
 * Runs the ReAct reasoning loop until the LLM produces either:
 * - A final text response (no tool calls)
 * - A set of tool commands to execute
 * - An error after MAX_STEPS
 *
 * The planner DOES NOT execute tools — it returns AiCommand[] for the executor.
 */
export async function runReActLoop(
  llm:             ILlmProvider,
  messages:        LlmMessage[],
  toolDefinitions: ToolSchema[],
  userId:          string
): Promise<PlannerResult> {
  let step = 0

  while (step < MAX_STEPS) {
    step++

    const loopRes = await llm.chat(messages, toolDefinitions, 'fast')

    if (loopRes.error) {
      logger.error('AI-PLANNER', `LLM error at step ${step}`, { error: loopRes.error, userId })
      const isRateLimit = loopRes.error.includes('rate_limit') || loopRes.error.includes('Rate limit')
      return {
        type:          'error',
        text:          isRateLimit
          ? 'Estoy con mucha demanda en este momento. Por favor, inténtalo de nuevo en unos minutos.'
          : 'Tuve un problema técnico al procesar tu solicitud. Por favor, inténtalo de nuevo.',
        steps:         step,
        loopExhausted: false,
      }
    }

    // Add assistant turn to messages (tool_calls must be preserved — required by API)
    messages.push(loopRes.message)

    // No tool calls → LLM finished reasoning with a text response
    if (!loopRes.message.tool_calls?.length) {
      return {
        type:  'text',
        text:  loopRes.message.content || '',
        steps: step,
      }
    }

    // LLM wants to call tools — return commands for the executor
    const commands: AiCommand[] = loopRes.message.tool_calls.map((tc: ToolCall) => ({
      toolName:   tc.function.name,
      toolCallId: tc.id,
      args:       (() => {
        try {
          return JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          return {}
        }
      })(),
    }))

    logger.info('AI-PLANNER', `Step ${step}: planned ${commands.length} command(s)`, { userId })

    return {
      type:     'commands',
      commands,
      steps:    step,
      messages, // Caller must feed tool results back before calling planner again
    }
  }

  // MAX_STEPS reached without resolution
  logger.warn('AI-PLANNER', 'ReAct loop exhausted', { userId, steps: step })
  return {
    type:          'error',
    text:          'Intenté varias veces procesar tu solicitud pero no pude completarla. Por favor, inténtalo de nuevo.',
    steps:         step,
    loopExhausted: true,
  }
}
