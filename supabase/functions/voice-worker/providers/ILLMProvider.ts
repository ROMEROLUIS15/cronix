/**
 * Provider-agnostic LLM interface.
 *
 * Every concrete provider (Groq, Gemini, Claude, GPT, ...) MUST implement this
 * interface. The agent loop in agent.ts depends on this interface — never on
 * a specific provider's SDK or HTTP shape.
 *
 * Tool definitions, messages, and responses use NEUTRAL types defined here.
 * Each provider is responsible for translating to/from its own wire format.
 *
 * Why neutral types:
 *   - OpenAI/Groq use {tool_calls: [{id, function:{name, arguments}}]}
 *   - Gemini uses {functionCall: {name, args}} or OpenAI-compat in its v1beta
 *   - Anthropic uses {tool_use: {id, name, input}}
 * If our agent depended on any of these shapes, swapping providers would
 * require touching agent.ts. With neutral types, agent.ts is provider-blind.
 */

// ── Neutral message format (used inside the agent loop) ───────────────────

export type NeutralRole = 'system' | 'user' | 'assistant' | 'tool'

export interface NeutralMessage {
  role:           NeutralRole
  /** Plain text content. Null when the assistant only emitted tool calls. */
  content:        string | null
  /** Present on assistant messages that requested tool execution. */
  tool_calls?:    NeutralToolCall[]
  /** Present on tool messages — links the tool result back to the call. */
  tool_call_id?:  string
  /** Present on tool messages — the tool's name (for provider replay). */
  name?:          string
}

// ── Neutral tool definition (used to advertise tools to the LLM) ──────────

export interface NeutralToolParameter {
  type:         'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  description?: string
  enum?:        string[]
}

export interface NeutralTool {
  name:        string
  description: string
  parameters: {
    type:       'object'
    properties: Record<string, NeutralToolParameter>
    required:   string[]
  }
}

// ── Neutral tool call (LLM → us, asking to execute a tool) ────────────────

export interface NeutralToolCall {
  /** Stable identifier for the tool call — used to link tool results back. */
  id:        string
  /** Name of the tool the LLM wants to invoke. */
  name:      string
  /** Raw JSON-encoded arguments. The agent loop parses + validates these. */
  arguments: string
}

// ── Request/response shapes ───────────────────────────────────────────────

export interface ChatRequest {
  /** System prompt (provider-specific encoding handled by the provider). */
  system:   string
  /** Conversation history (already trimmed by caller). */
  messages: NeutralMessage[]
  /** Tool definitions exposed to the LLM. Empty array = chat-only mode. */
  tools:    NeutralTool[]
  /** Sampling temperature. 0.1 by default for tool-calling reliability. */
  temperature?: number
  /** Max output tokens. Defaults to 400. */
  maxOutputTokens?: number
}

export interface ChatResponse {
  /** Assistant's text content. May be null when tool calls were emitted. */
  content:    string | null
  /** Tool calls the LLM wants executed. Empty array means turn complete. */
  toolCalls:  NeutralToolCall[]
  /** Total tokens consumed (best-effort — providers vary). */
  tokensUsed: number
  /** Identifier of the model that produced this response (for logs). */
  modelUsed:  string
}

// ── Provider interface ────────────────────────────────────────────────────

export interface ILLMProvider {
  /** Lowercase identifier (e.g. "groq", "gemini"). Used in logs + selection. */
  readonly name: string
  /** Single-shot chat completion. May internally retry/rotate keys/etc. */
  chat(req: ChatRequest): Promise<ChatResponse>
}
