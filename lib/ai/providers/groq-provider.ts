import { ISttProvider, ILlmProvider, SttOptions, SttResult, LlmMessage, LlmResult, LlmStreamResult, LlmTier, ToolSchema } from './types'
import { safeSTT, safeLLM } from '../resilience'
import { logger } from '@/lib/logger'

/**
 * Returns the index just after the first sentence-ending punctuation in `text`,
 * provided the sentence is at least MIN_SENTENCE_CHARS long.
 * A sentence this short ("Sí.", "Ok.") is not worth a TTS round-trip alone.
 */
const MIN_SENTENCE_CHARS = 30
function firstSentenceEnd(text: string): number {
  if (text.length < MIN_SENTENCE_CHARS) return -1
  const m = text.match(/[.!?](?:\s|$)/)
  return m?.index !== undefined ? m.index + 1 : -1
}

// quality: para acciones de escritura (ahora usamos 8b-instant como primario para no saturar los Rate Limits de Groq)
// fast:    para consultas de lectura (respuesta más rápida)
const MODEL_BY_TIER: Record<LlmTier, { primary: string; fallback: string }> = {
  quality: { primary: 'llama-3.1-8b-instant', fallback: 'llama-3.3-70b-versatile' },
  fast:    { primary: 'llama-3.1-8b-instant', fallback: 'llama-3.3-70b-versatile' },
}

export class GroqProvider implements ISttProvider, ILlmProvider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async transcribe(audio: Blob, options?: SttOptions): Promise<SttResult> {
    const res = await safeSTT(audio, this.apiKey, options?.language)
    return {
      text: res.data?.text || '',
      error: res.error,
      latency: res.latency
    }
  }

  async chat(messages: LlmMessage[], tools?: ToolSchema[], tier: LlmTier = 'fast'): Promise<LlmResult> {
    const { primary, fallback } = MODEL_BY_TIER[tier]
    const res = await safeLLM(messages, tools ?? [], this.apiKey, primary, fallback)

    if (res.error || !res.data) {
      return {
        message: { role: 'assistant', content: '' },
        model:   res.modelUsed ?? 'unknown',
        latency: res.latency,
        tokens:  0,
        error:   res.error ?? 'LLM error',
      }
    }

    const data   = res.data as { choices: { message: LlmMessage }[]; usage?: { total_tokens?: number } }
    const choice = data.choices?.[0]
    if (!choice) {
      return {
        message: { role: 'assistant', content: '' },
        model:   res.modelUsed ?? 'unknown',
        latency: res.latency,
        tokens:  0,
        error:   'Empty response from LLM',
      }
    }
    return {
      message: choice.message,
      model:   res.modelUsed ?? 'unknown',
      latency: res.latency,
      tokens:  data.usage?.total_tokens ?? 0,
    }
  }

  /**
   * Streams Groq SSE response and returns both the full text and the first
   * complete sentence extracted mid-stream for early TTS dispatch.
   *
   * Only use with tier='quality' (no tool_choice) — the planner ReAct loop
   * requires tool_calls which streaming cannot yield as structured objects.
   */
  async streamChat(messages: LlmMessage[], tier: LlmTier = 'quality'): Promise<LlmStreamResult> {
    const { primary, fallback } = MODEL_BY_TIER[tier]

    const attempt = async (model: string): Promise<LlmStreamResult> => {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_tokens:  100,
          temperature: 0.1,
          stream:      true,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`Groq stream ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let ttsText  = ''
      let buf      = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break

          try {
            const chunk  = JSON.parse(payload) as { choices: { delta: { content?: string } }[] }
            const token  = chunk.choices?.[0]?.delta?.content
            if (!token) continue
            fullText += token

            // Extract first complete sentence once we have enough text
            if (!ttsText) {
              const end = firstSentenceEnd(fullText)
              if (end > 0) ttsText = fullText.slice(0, end)
            }
          } catch {
            // Malformed chunk — skip silently
          }
        }
      }

      // No sentence boundary found → apply same truncation as the non-stream path
      if (!ttsText) {
        if (fullText.length <= 220) {
          ttsText = fullText
        } else {
          const cut     = fullText.slice(0, 220)
          const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'))
          ttsText = lastDot > 80 ? fullText.slice(0, lastDot + 1) : cut
        }
      }

      return { fullText, ttsText }
    }

    try {
      return await attempt(primary)
    } catch (primaryErr: any) {
      logger.warn('AI-LLM-STREAM', `Primary stream failed (${primaryErr.message}), trying fallback`)
      return await attempt(fallback)
    }
  }
}
