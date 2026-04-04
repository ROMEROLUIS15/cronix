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
    input: Blob | string, 
    businessId: string, 
    userId: string, 
    businessName: string,
    userTimezone: string = 'UTC'
  ): Promise<AssistantResponse> {
    
    // 1. Transcription (STT) - Skip if input is already text (Streaming Mode)
    let sttRes: SttResult;

    if (typeof input === 'string') {
      sttRes = { text: input, latency: 0 }
      logger.info('AI-ASSISTANT', 'Direct text received from stream', { userId })
    } else {
      try {
        sttRes = await this.stt.transcribe(input, { language: 'es' })
        const heardText = sttRes.text?.trim() || ''
        
        if (heardText.length === 0) {
          logger.warn('AI-ASSISTANT', 'Empty transcription received', { userId })
          return {
            text: 'Lo siento, no logré captar lo que dijiste. ¿Podrías repetirlo un poco más claro?',
            audioUrl: null,
            useNativeFallback: true,
            actionPerformed: false
          }
        }
        
        logger.info('AI-ASSISTANT-STT', `Escuchado: "${heardText}"`, { userId, latency: sttRes.latency })
        sttRes.text = heardText // Cleaned
      } catch (err: any) {
        logger.error('AI-ASSISTANT-STT', 'STT Critical Failure', { error: err.message, userId })
        return {
          text: 'Hubo un problema técnico al procesar tu voz. Por favor, inténtalo de nuevo en un momento.',
          audioUrl: null,
          useNativeFallback: true,
          actionPerformed: false
        }
      }
    }

    // 2. Load Memory Context & System Prompt
    const { getSystemPrompt } = await import('./assistant-prompt-helper')
    const { memoryService } = await import('./memory-service')
    const history = aiMemory.getHistory(userId)
    
    // 🌟 RAG: Retrieve relevant long-term memories
    const relevantMemories = await memoryService.retrieve(userId, businessId, sttRes.text)
    const memoryContext = relevantMemories.length > 0
      ? `\nRECUERDA ESTE CONTEXTO DEL PASADO:\n${relevantMemories.map(m => `- ${m.content}`).join('\n')}`
      : ''

    const systemPrompt = getSystemPrompt(undefined, businessName, userTimezone) + memoryContext
    
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: sttRes.text }
    ]

    // 3. LLM: Initial Chain (Reasoning + Tools)
    const toolDefinitions = toolRegistry.getDefinitions()
    const llmRes = await this.llm.chat(messages, toolDefinitions)
    
    if (llmRes.error) {
      logger.error('AI-ASSISTANT-LLM', 'LLM Primary Failure', { error: llmRes.error, userId })
      throw new Error(`LLM Error: ${llmRes.error}`)
    }

    let replyText = llmRes.message.content || ''
    let actionPerformed = false

    // 3.1. Tool Orchestration (Multi-pass Support)
    if (llmRes.message.tool_calls?.length) {
      actionPerformed = true
      const toolMessages: LlmMessage[] = []
      
      logger.info('AI-ASSISTANT-TOOLS', `Executing ${llmRes.message.tool_calls.length} tool(s)`, { userId })
      
      for (const toolCall of llmRes.message.tool_calls) {
        let toolResult: string
        try {
          toolResult = await toolRegistry.execute(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments),
            businessId
          )
          logger.info('AI-TOOL-EXEC', `Success: ${toolCall.function.name}`, { userId })
        } catch (err: any) {
          logger.error('AI-TOOL-EXEC', `Failed: ${toolCall.function.name}`, { error: err.message, userId })
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
      ], toolDefinitions)
      
      if (secondLlmRes.error) {
        logger.error('AI-ASSISTANT-LLM', 'LLM Second Pass Failure', { error: secondLlmRes.error, userId })
        replyText = 'He realizado la acción, pero tuve un problema al confirmar los detalles.'
      } else {
        replyText = secondLlmRes.message.content || 'Acción completada.'
      }
    }

    // 4. Update Memory Context (Short-term)
    aiMemory.addMessage(userId, { role: 'user', content: sttRes.text })
    aiMemory.addMessage(userId, { role: 'assistant', content: replyText })

    // 🌟 5. Store Long-term Memory (Asymptotically if relevant)
    // We only store if the message is substantial and not just a tool output
    if (sttRes.text.length > 25 && !actionPerformed) {
       memoryService.store(userId, businessId, sttRes.text, { type: 'user_fact' })
    }

    // 6. TTS: Text -> Audio
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
