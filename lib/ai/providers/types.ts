export interface SttOptions {
  language?: string
}

export interface SttResult {
  text: string
  error?: string
  latency: number
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

export interface LlmResult {
  message: LlmMessage
  model: string
  latency: number
  error?: string
}

export interface TtsResult {
  audioUrl: string | null
  useNativeFallback: boolean
  error?: string
  latency: number
}

// ── PROVIDER INTERFACES ──────────────────────────────────────────────────

export interface ISttProvider {
  transcribe(audio: Blob, options?: SttOptions): Promise<SttResult>
}

export type LlmTier = 'fast' | 'quality'

export interface ILlmProvider {
  chat(messages: LlmMessage[], tools?: any[], tier?: LlmTier): Promise<LlmResult>
}

export interface ITtsProvider {
  synthesize(text: string): Promise<TtsResult>
}
