import { ISttProvider, ILlmProvider, ITtsProvider, LlmMessage, SttResult } from './providers/types'
import { toolRegistry } from './tool-registry'
import { aiMemory } from './memory'
import { logger } from '@/lib/logger'

export interface AssistantResponse {
  text: string
  audioUrl: string | null
  useNativeFallback: boolean
  actionPerformed?: boolean
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
    userId: string, 
    businessName: string,
    userTimezone: string = 'UTC'
  ): Promise<AssistantResponse> {
    
    // 1. STT: Transcribe Audio
    let sttRes: SttResult;
    try {
      sttRes = await this.stt.transcribe(audioBlob, { language: 'es' })
      logger.info('AI-VOICE-STT', `Escuchado: "${sttRes.text ?? ''}"`, { userId })
      
      if (!sttRes.text || sttRes.text.trim().length === 0) {
        throw new Error('STT returned empty text')
      }
    } catch (err: any) {
      logger.warn('ASSISTANT', 'STT Failed or empty', { error: err.message, userId })
      return {
        text: 'Lo siento, no pude escucharte con claridad. ¿Podrías repetirlo?',
        audioUrl: null,
        useNativeFallback: true,
        actionPerformed: false
      }
    }
    if (!sttRes.text) throw new Error(sttRes.error || 'Speech-to-text failed')

    // 2. Load Memory Context & System Prompt
    const { getSystemPrompt } = await import('./assistant-prompt-helper')
    const history = aiMemory.getHistory(userId)
    const messages: LlmMessage[] = [
      { role: 'system', content: getSystemPrompt(undefined, businessName, userTimezone) },
      ...history,
      { role: 'user', content: sttRes.text }
    ]

    // 3. LLM: Initial Chain (Reasoning + Tools)
    const llmRes = await this.llm.chat(messages, toolRegistry.getDefinitions())
    if (llmRes.error) throw new Error(llmRes.error)

    let replyText = llmRes.message.content || ''
    let actionPerformed = false

    // 3.1. Tool Orchestration (Multi-pass Support)
    if (llmRes.message.tool_calls?.length) {
      actionPerformed = true
      const toolMessages: LlmMessage[] = []
      
      for (const toolCall of llmRes.message.tool_calls) {
        let toolResult: string
        try {
          toolResult = await toolRegistry.execute(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments),
            businessId
          )
        } catch (err: any) {
          logger.error('AI-TOOL-EXEC', `Execution failed: ${err.message}`, { tool: toolCall.function.name, businessId })
          toolResult = "Error técnico al ejecutar la acción."
        }
        
        toolMessages.push({ 
          role: 'tool', 
          tool_call_id: toolCall.id, 
          name: toolCall.function.name, 
          content: toolResult 
        })
      }

      // Second pass: Final conversational response with ALL tool results
      const secondLlmRes = await this.llm.chat([
        ...messages,
        llmRes.message,
        ...toolMessages
      ])
      
      replyText = secondLlmRes.message.content || 'Acción completada con éxito.'
    }

    // 4. Update Memory Context
    aiMemory.addMessage(userId, { role: 'user', content: sttRes.text })
    aiMemory.addMessage(userId, { role: 'assistant', content: replyText })

    // 5. TTS: Text -> Audio
    const ttsRes = await this.tts.synthesize(replyText)
    const audioUrl = ttsRes.audioUrl

    return {
      text: replyText,
      audioUrl,
      useNativeFallback: !audioUrl,
      actionPerformed,
      debug: { sttLatency: sttRes.latency, llmLatency: llmRes.latency, ttsLatency: ttsRes.latency }
    }
  }
}
