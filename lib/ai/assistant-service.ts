import { ISttProvider, ILlmProvider, ITtsProvider, LlmMessage } from './providers/types'
import { toolRegistry } from './tool-registry'
import { aiMemory } from './memory'
import { logger } from '@/lib/logger'

export interface AssistantResponse {
  text: string
  audioUrl: string | null
  useNativeFallback: boolean
  debug?: any
}

export class AssistantService {
  constructor(
    private stt: ISttProvider,
    private llm: ILlmProvider,
    private tts: ITtsProvider
  ) {}

  async processVoiceRequest(
    audioBlob: Blob,
    businessId: string,
    userId: string
  ): Promise<AssistantResponse> {
    
    // 1. STT: Audio -> Text
    const sttRes = await this.stt.transcribe(audioBlob)
    if (!sttRes.text) throw new Error(sttRes.error || 'Speech-to-text failed')

    // 2. Load Memory Context & System Prompt
    const { getSystemPrompt } = await import('./assistant-prompt-helper')
    const history = aiMemory.getHistory(userId)
    const messages: LlmMessage[] = [
      { role: 'system', content: getSystemPrompt() }, // Initial default
      ...history,
      { role: 'user', content: sttRes.text }
    ]

    // 3. LLM: Initial Chain (Reasoning + Tools)
    const llmRes = await this.llm.chat(messages, toolRegistry.getDefinitions())
    if (llmRes.error) throw new Error(llmRes.error)

    let replyText = llmRes.message.content || ''

    // 3.1. Tool Orchestration (Multi-pass if needed)
    if (llmRes.message.tool_calls?.length) {
      const toolCall = llmRes.message.tool_calls[0]!
      
      let toolResult: string
      try {
        toolResult = await toolRegistry.execute(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments),
          businessId
        )
      } catch (err: any) {
        logger.error('AI-TOOL-EXEC', `Execution failed: ${err.message}`, { tool: toolCall.function.name, businessId })
        toolResult = "Hubo un error técnico al ejecutar la acción. Por favor, intenta de nuevo."
      }

      // Second pass: Final conversational response
      const secondLlmRes = await this.llm.chat([
        ...messages,
        llmRes.message,
        { 
          role: 'tool', 
          tool_call_id: toolCall.id, 
          name: toolCall.function.name, 
          content: toolResult 
        }
      ])
      
      replyText = secondLlmRes.message.content || toolResult
    }

    // 4. Update Memory Context
    aiMemory.addMessage(userId, { role: 'user', content: sttRes.text })
    aiMemory.addMessage(userId, { role: 'assistant', content: replyText })

    // 5. TTS: Text -> Audio
    const ttsRes = await this.tts.synthesize(replyText)

    return {
      text: replyText,
      audioUrl: ttsRes.audioUrl,
      useNativeFallback: ttsRes.useNativeFallback,
      debug: { sttLatency: sttRes.latency, llmLatency: llmRes.latency, ttsLatency: ttsRes.latency }
    }
  }
}
