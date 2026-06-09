import { ITtsProvider, TtsResult } from './types'
import { safeDeepgramTTS } from '../resilience'

/**
 * 🎙️ Deepgram Aura Provider
 * Super-fast, low-latency Text-to-Speech engine.
 */
export class DeepgramProvider implements ITtsProvider {
  constructor(
    private apiKey: string, 
    private model: string = 'aura-2-nestor-es',
    private businessId?: string
  ) {}

  async synthesize(text: string): Promise<TtsResult> {
    const res = await safeDeepgramTTS(text, this.apiKey, this.model, this.businessId)
    return {
      audioUrl: res.data?.audioUrl || null,
      useNativeFallback: res.data?.useNativeFallback || false,
      error: res.error,
      latency: res.latency
    }
  }
}
