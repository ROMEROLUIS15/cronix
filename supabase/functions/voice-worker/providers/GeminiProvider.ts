/**
 * GeminiProvider — Google Gemini via the OpenAI-compatible endpoint.
 *
 * Why the OpenAI-compat endpoint instead of the native generateContent API:
 *   - Gemini's native API uses {functionDeclarations, contents:[{role, parts:[]}]}
 *     which would require a non-trivial translator
 *   - The OpenAI-compat endpoint at v1beta/openai/chat/completions accepts the
 *     same tools/messages shape we already build for Groq
 *   - Trades a small surface (one URL difference) for vastly less translation code
 *
 * Documentation:
 *   https://ai.google.dev/gemini-api/docs/openai
 *
 * Required env var:
 *   GEMINI_API_KEY
 *
 * Defaults to gemini-2.0-flash. Override via env var GEMINI_MODEL if needed.
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

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL   = Deno.env.get('GEMINI_MODEL')   ?? 'gemini-2.0-flash'
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

// ── Wire types (OpenAI-compat shape) ─────────────────────────────────────

interface GeminiResponse {
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

interface OpenAIMessage {
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

// ── Translation helpers ──────────────────────────────────────────────────

function toOpenAITools(tools: NeutralTool[]): unknown[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.parameters,
    },
  }))
}

function toOpenAIMessages(system: string, messages: NeutralMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    const msg: OpenAIMessage = { role: m.role, content: m.content }
    if (m.tool_calls?.length) {
      msg.tool_calls = m.tool_calls.map(tc => ({
        id:       tc.id,
        type:     'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }))
    }
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
    if (m.name)         msg.name         = m.name
    out.push(msg)
  }
  return out
}

function toChatResponse(resp: GeminiResponse, modelUsed: string): ChatResponse {
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

// ── Provider implementation ──────────────────────────────────────────────

export class GeminiProvider implements ILLMProvider {
  readonly name = 'gemini'

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not set')
    }

    const messages    = toOpenAIMessages(req.system, req.messages)
    const tools       = req.tools.length > 0 ? toOpenAITools(req.tools) : undefined
    const temperature = req.temperature      ?? 0.1
    const maxTokens   = req.maxOutputTokens  ?? 400

    const body: Record<string, unknown> = {
      model:      GEMINI_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    }
    if (tools) {
      body.tools       = tools
      body.tool_choice = 'auto'
    }

    const res = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${GEMINI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300)
      throw new Error(`Gemini[${GEMINI_MODEL}] ${res.status}: ${errText}`)
    }

    const json = await res.json() as GeminiResponse
    return toChatResponse(json, `gemini/${GEMINI_MODEL}`)
  }
}
