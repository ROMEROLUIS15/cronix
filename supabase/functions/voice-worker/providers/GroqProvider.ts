/**
 * GroqProvider — wraps the existing Groq behavior behind ILLMProvider.
 *
 * This is INTENTIONALLY a literal port of the previous inline logic in agent.ts.
 * No behavioral changes:
 *   - 70B versatile primary, 8B instant fallback (on any error)
 *   - Per-key 429 rotation
 *   - Same temperature, max_tokens
 *   - Same OpenAI-compatible payload shape (Groq uses the OpenAI tool-call schema)
 *
 * Translation responsibilities:
 *   - NeutralTool[] → OpenAI `tools` array
 *   - NeutralMessage[] → OpenAI messages (1:1, the shape is already compatible)
 *   - Groq response → ChatResponse with neutral toolCalls
 *
 * Required env var:
 *   LLM_API_KEY  (comma-separated for key rotation)
 */

import type {
  ILLMProvider,
  ChatRequest,
  ChatResponse,
  NeutralTool,
  NeutralMessage,
  NeutralToolCall,
} from './ILLMProvider.ts'

// ── Config ────────────────────────────────────────────────────────────────

const GROQ_KEYS = (Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY') ?? '')
  .split(',').map(k => k.trim()).filter(Boolean)

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

const PRIMARY_MODEL  = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'llama-3.1-8b-instant'

// ── Groq wire types ──────────────────────────────────────────────────────

interface GroqResponse {
  choices: Array<{
    message: {
      content?:    string | null
      tool_calls?: Array<{
        id:       string
        type:     'function'
        function: { name: string; arguments: string }
      }>
    }
  }>
  usage?: { total_tokens?: number }
}

// ── Translation helpers ──────────────────────────────────────────────────

/** Neutral tool defs → OpenAI/Groq tool defs (1:1 shape). */
function toGroqTools(tools: NeutralTool[]): unknown[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.parameters,
    },
  }))
}

/** Neutral messages → Groq messages. tool_calls field maps 1:1. */
interface GroqMessage {
  role:           'system' | 'user' | 'assistant' | 'tool'
  content:        string | null
  tool_calls?:    Array<{
    id:       string
    type:     'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?:  string
  name?:          string
}

function toGroqMessages(system: string, messages: NeutralMessage[]): GroqMessage[] {
  const out: GroqMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    const groqMsg: GroqMessage = { role: m.role, content: m.content }
    if (m.tool_calls?.length) {
      groqMsg.tool_calls = m.tool_calls.map(tc => ({
        id:       tc.id,
        type:     'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }))
    }
    if (m.tool_call_id) groqMsg.tool_call_id = m.tool_call_id
    if (m.name)         groqMsg.name         = m.name
    out.push(groqMsg)
  }
  return out
}

/** Groq response → neutral ChatResponse. */
function toChatResponse(resp: GroqResponse, modelUsed: string): ChatResponse {
  const choice = resp.choices?.[0]?.message
  const toolCalls: NeutralToolCall[] = (choice?.tool_calls ?? []).map(tc => ({
    id:        tc.id,
    name:      tc.function.name,
    arguments: tc.function.arguments,
  }))
  return {
    content:    choice?.content ?? null,
    toolCalls,
    tokensUsed: resp.usage?.total_tokens ?? 0,
    modelUsed,
  }
}

// ── Single-attempt HTTP call ─────────────────────────────────────────────

async function callOnce(
  body:      Record<string, unknown>,
  apiKey:    string,
): Promise<GroqResponse> {
  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300)
    const err = new Error(`Groq[${body.model}] ${res.status}: ${errText}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return await res.json() as GroqResponse
}

/**
 * Calls Groq with a specific model + key rotation on 429.
 * Same algorithm as the previous inline implementation.
 */
async function callWithKeyRotation(body: Record<string, unknown>): Promise<GroqResponse> {
  if (GROQ_KEYS.length === 0) throw new Error('LLM_API_KEY not set')
  let lastErr: unknown = null
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    try {
      return await callOnce(body, GROQ_KEYS[i]!)
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number }).status
      if (status === 429 && i < GROQ_KEYS.length - 1) {
        console.warn(`[GROQ-PROVIDER] key ${i + 1}/${GROQ_KEYS.length} hit 429 — rotating`)
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('All Groq keys exhausted')
}

// ── Provider implementation ──────────────────────────────────────────────

export class GroqProvider implements ILLMProvider {
  readonly name = 'groq'

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages    = toGroqMessages(req.system, req.messages)
    const tools       = req.tools.length > 0 ? toGroqTools(req.tools) : undefined
    const temperature = req.temperature      ?? 0.1
    const maxTokens   = req.maxOutputTokens  ?? 400

    const buildBody = (model: string): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }
      if (tools) {
        body.tools                = tools
        body.tool_choice          = 'auto'
        body.parallel_tool_calls  = false  // prevents duplicate write tools
      }
      return body
    }

    // Primary: 70B versatile
    try {
      const resp = await callWithKeyRotation(buildBody(PRIMARY_MODEL))
      return toChatResponse(resp, `groq/${PRIMARY_MODEL}`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`[GROQ-PROVIDER] ${PRIMARY_MODEL} failed, falling back to ${FALLBACK_MODEL}: ${reason}`)
    }

    // Fallback: 8B instant
    const resp = await callWithKeyRotation(buildBody(FALLBACK_MODEL))
    return toChatResponse(resp, `groq/${FALLBACK_MODEL}`)
  }
}
