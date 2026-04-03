import { ISttProvider, ILlmProvider, SttOptions, SttResult, LlmMessage, LlmResult } from './types'
import { safeSTT, safeLLM } from '../resilience'

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

  async chat(messages: LlmMessage[], tools?: any[]): Promise<LlmResult> {
    const res = await safeLLM(messages, tools || [], this.apiKey)
    
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
