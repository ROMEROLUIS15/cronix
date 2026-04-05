import { ISttProvider, ILlmProvider, SttOptions, SttResult, LlmMessage, LlmResult, LlmTier } from './types'
import { safeSTT, safeLLM } from '../resilience'

// quality: 70b para acciones de escritura (mayor fiabilidad en tool-calling)
// fast:    8b para consultas de lectura (500k TPD, respuesta rápida)
const MODEL_BY_TIER: Record<LlmTier, { primary: string; fallback: string }> = {
  quality: { primary: 'llama-3.3-70b-versatile', fallback: 'llama-3.1-8b-instant' },
  fast:    { primary: 'llama-3.1-8b-instant',    fallback: 'llama-3.3-70b-versatile' },
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

  async chat(messages: LlmMessage[], tools?: any[], tier: LlmTier = 'fast'): Promise<LlmResult> {
    const { primary, fallback } = MODEL_BY_TIER[tier]
    const res = await safeLLM(messages, tools || [], this.apiKey, primary, fallback)

    if (res.error || !res.data) {
      return {
        message: { role: 'assistant', content: '' },
        model: res.modelUsed || 'unknown',
        latency: res.latency,
        error: res.error || 'LLM error'
      }
    }

    const choice = res.data.choices[0]
    return {
      message: choice.message as LlmMessage,
      model: res.modelUsed || choice.model,
      latency: res.latency
    }
  }
}
