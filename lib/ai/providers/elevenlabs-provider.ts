import { ITtsProvider, TtsResult } from './types'
import { safeTTS } from '../resilience'

export class ElevenLabsProvider implements ITtsProvider {
  private apiKey: string
  private voiceId: string

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey
    this.voiceId = voiceId
  }

  async synthesize(text: string): Promise<TtsResult> {
    const res = await safeTTS(text, this.apiKey, this.voiceId)
    return {
      audioUrl: res.data?.audioUrl || null,
      useNativeFallback: res.data?.useNativeFallback || false,
      error: res.error,
      latency: res.latency
    }
  }
}
