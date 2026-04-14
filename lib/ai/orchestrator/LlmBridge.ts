/**
 * LlmBridge.ts — Adapter: ILlmProvider → IMockLlmProvider.
 *
 * ExecutionEngine expects IMockLlmProvider (chat returns MockLlmResponse).
 * GroqProvider implements ILlmProvider (chat returns LlmResult).
 *
 * This bridge adapts without modifying either side.
 * Passes 'quality' tier to Groq for tool-calling reliability (70b model).
 */

import type { IMockLlmProvider, MockLlmResponse } from './execution-engine'
import type { ILlmProvider, LlmMessage } from '@/lib/ai/providers/types'

export class LlmBridge implements IMockLlmProvider {
  constructor(private llm: ILlmProvider) {}

  async chat(messages: LlmMessage[], toolDefs?: unknown[]): Promise<MockLlmResponse> {
    const result = await this.llm.chat(
      messages,
      (toolDefs ?? []) as Parameters<ILlmProvider['chat']>[1],
      'quality',
    )

    return {
      content: result.message.content ?? null,
      tool_calls: result.message.tool_calls?.map((tc) => ({
        id:       tc.id,
        type:     'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    }
  }
}
