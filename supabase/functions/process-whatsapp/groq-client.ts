/**
 * Groq HTTP client — shared by the ReAct loop and Whisper STT.
 *
 * Exposes:
 *  - callLlm          → unified LLM caller (chat completions)
 *  - heliconeHeaders  → Helicone gateway header builder
 *  - LlmRateLimitError / CircuitBreakerError — typed error classes
 *  - AgentMessage / LlmResponse / ToolCall   — message types
 */

import {
  checkCircuitBreaker,
  reportServiceFailure,
  reportServiceSuccess,
} from "./guards.ts"

// ── Config ────────────────────────────────────────────────────────────────────

export const SMALL_MODEL   = 'llama-3.1-8b-instant'    // decision loop + tool calling
export const LARGE_MODEL   = 'llama-3.3-70b-versatile'  // final empathetic response
export const WHISPER_MODEL = 'whisper-large-v3-turbo'
export const MAX_STEPS     = 2

// Helicone gateway: proxies Groq calls for latency, cost, and threat monitoring.
// @ts-ignore — Deno runtime global
const HELICONE_API_KEY = Deno.env.get('HELICONE_API_KEY') ?? ''
const GROQ_BASE        = HELICONE_API_KEY
  ? 'https://groq.helicone.ai/openai/v1'
  : 'https://api.groq.com/openai/v1'

export const LLM_API_URL     = `${GROQ_BASE}/chat/completions`
export const WHISPER_API_URL = `${GROQ_BASE}/audio/transcriptions`

export function heliconeHeaders(properties: Record<string, string> = {}, cache = false): Record<string, string> {
  if (!HELICONE_API_KEY) return {}
  const headers: Record<string, string> = {
    'Helicone-Auth':            `Bearer ${HELICONE_API_KEY}`,
    'Helicone-Property-Source': 'whatsapp-webhook',
  }
  if (cache) {
    headers['Helicone-Cache-Enabled'] = 'true'
  }
  for (const [key, value] of Object.entries(properties)) {
    headers[`Helicone-Property-${key}`] = value
  }
  return headers
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolCallFunction {
  name:      'confirm_booking' | 'reschedule_booking' | 'cancel_booking'
  arguments: string // JSON stringified
}

export interface ToolCall {
  id:       string
  type:     'function'
  function: ToolCallFunction
}

export interface AgentMessage {
  role:           'system' | 'user' | 'assistant' | 'tool'
  content:        string | null
  tool_calls?:    ToolCall[]
  tool_call_id?:  string
  name?:          string
}

export interface LlmResponse {
  choices?: Array<{
    message?: {
      content?:    string | null
      tool_calls?: ToolCall[]
    }
    finish_reason?: string
  }>
  usage?: { total_tokens: number }
  error?: { message?: string; type?: string; code?: string }
}

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * Thrown when the LLM provider responds with HTTP 429 (rate limit exceeded).
 */
export class LlmRateLimitError extends Error {
  readonly retryAfterSecs: number

  constructor(retryAfterSecs: number) {
    super(`LLM rate limit exceeded — retry after ${retryAfterSecs}s`)
    this.name           = 'LlmRateLimitError'
    this.retryAfterSecs = retryAfterSecs
  }
}

/**
 * Thrown when the circuit breaker is OPEN (service is down).
 */
export class CircuitBreakerError extends Error {
  constructor(serviceName: string) {
    super(`Service ${serviceName} is currently unavailable (Circuit OPEN)`)
    this.name = 'CircuitBreakerError'
  }
}

// ── LLM Caller ────────────────────────────────────────────────────────────────

export async function callLlm(
  model:         string,
  messages:      AgentMessage[],
  tools:         unknown[],
  heliconeProps: Record<string, string> = {},
  enableCache    = false,
): Promise<{ response: LlmResponse; tokens: number }> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('LLM_API_KEY no configurada')

  const serviceName = 'GROQ_LLM'
  if (!(await checkCircuitBreaker(serviceName))) {
    throw new CircuitBreakerError(serviceName)
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: tools.length > 0 ? 0.0 : 0.2,
    max_tokens:  tools.length > 0 ? 512  : 500,
  }
  if (tools.length > 0) {
    payload.tools                = tools
    payload.tool_choice          = 'auto'
    payload.parallel_tool_calls  = false  // prevent duplicate bookings from parallel calls
  }

  let res: Response
  try {
    res = await fetch(LLM_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        ...heliconeHeaders(heliconeProps, enableCache),
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    await reportServiceFailure(serviceName)
    throw err
  }

  const data: LlmResponse = await res.json()

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
      throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
    }
    if (res.status >= 500) await reportServiceFailure(serviceName)
    throw new Error(`LLM API Error: ${JSON.stringify(data.error ?? data)}`)
  }

  await reportServiceSuccess(serviceName)

  return {
    response: data,
    tokens:   data.usage?.total_tokens ?? 0,
  }
}
