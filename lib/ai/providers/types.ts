export interface SttOptions {
  language?: string
}

export interface SttResult {
  text: string
  error?: string
  latency: number
}

// ── Tool Calling Types ────────────────────────────────────────────────────────

export interface ToolCallFunction {
  name:      string
  arguments: string  // JSON stringified — always validate before JSON.parse
}

export interface ToolCall {
  id:       string
  type:     'function'
  function: ToolCallFunction
}

// Schema property for a single tool parameter
export interface ToolParamProperty {
  type:         string
  description?: string
  enum?:        string[]
}

// Full JSON Schema for a tool as sent to the LLM
export interface ToolSchema {
  type: 'function'
  function: {
    name:        string
    description: string
    parameters: {
      type:                 'object'
      properties:           Record<string, ToolParamProperty>
      required:             string[]
      additionalProperties?: false
    }
  }
}

// ── LLM Message Types ─────────────────────────────────────────────────────────

export interface LlmMessage {
  role:          'system' | 'user' | 'assistant' | 'tool'
  content?:      string | null
  tool_calls?:   ToolCall[]     // strongly typed — was `any[]`
  tool_call_id?: string
  name?:         string
}

export interface LlmResult {
  message: LlmMessage
  model:   string
  latency: number
  error?:  string
}

export interface TtsResult {
  audioUrl:          string | null
  useNativeFallback: boolean
  error?:            string
  latency:           number
}

// ── Provider Interfaces ───────────────────────────────────────────────────────

export interface ISttProvider {
  transcribe(audio: Blob, options?: SttOptions): Promise<SttResult>
}

export type LlmTier = 'fast' | 'quality'

export interface LlmStreamResult {
  /** Complete LLM response text */
  fullText: string
  /** First complete sentence (≤220 chars) — ready for TTS before LLM finishes */
  ttsText:  string
}

export interface ILlmProvider {
  chat(messages: LlmMessage[], tools?: ToolSchema[], tier?: LlmTier): Promise<LlmResult>
  /**
   * Optional: stream the LLM response token-by-token, extract first sentence for early TTS.
   * Falls back gracefully to chat() if not implemented.
   * Only use with tier='quality' (no tool calls).
   */
  streamChat?(messages: LlmMessage[], tier?: LlmTier): Promise<LlmStreamResult>
}

export interface ITtsProvider {
  synthesize(text: string): Promise<TtsResult>
}
