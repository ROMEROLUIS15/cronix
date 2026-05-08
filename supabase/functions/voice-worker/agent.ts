/**
 * Agent loop — Cerebras 70B with native tool calling.
 *
 * Manual implementation of the OpenAI-compatible tool-calling protocol:
 *   1. Send messages + tool defs to LLM
 *   2. If response has tool_calls, execute each, append tool messages
 *   3. Loop until LLM returns plain text (or MAX_STEPS exhausted)
 *
 * Per-turn deduplication: same (toolName + args) blocked. Prevents the
 * 6-duplicate-bookings bug seen with the previous architecture.
 *
 * Provider strategy: Cerebras 70B primary (~1s, free 60 RPM). Falls back to
 * Groq 8B-instant (~0.5s) if Cerebras returns 5xx or times out.
 *
 * Required env vars:
 *   CEREBRAS_API_KEY  (recommended)
 *   LLM_API_KEY       (Groq, comma-separated for key rotation)
 */

import { buildSystemPrompt }                          from './prompt.ts'
import { TOOL_DEFINITIONS, WRITE_TOOLS, executeTool, type ToolContext } from './tools.ts'
import type { AgentInput, AgentOutput, LlmMessage, AppointmentNotification, NotificationType } from './types.ts'

// ── Provider config ────────────────────────────────────────────────────────

const CEREBRAS_KEY = Deno.env.get('CEREBRAS_API_KEY') ?? ''
const GROQ_KEYS    = (Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY') ?? '')
  .split(',').map(k => k.trim()).filter(Boolean)

const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions'
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions'
const CEREBRAS_TIMEOUT_MS = 6000  // bail fast — Groq fallback is acceptable

const MAX_STEPS = 3   // 1-2 tool calls + final synthesis fits comfortably

// ── LLM call (single-shot, with provider fallback) ─────────────────────────

interface LlmResponse {
  choices: Array<{
    message: {
      content?:   string | null
      tool_calls?: Array<{
        id:       string
        type:     'function'
        function: { name: string; arguments: string }
      }>
    }
  }>
  usage?: { total_tokens?: number }
}

async function callCerebras(messages: LlmMessage[]): Promise<LlmResponse> {
  if (!CEREBRAS_KEY) throw new Error('CEREBRAS_API_KEY not set')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CEREBRAS_TIMEOUT_MS)
  try {
    const res = await fetch(CEREBRAS_URL, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${CEREBRAS_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       'llama3.3-70b',
        messages,
        tools:       TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens:  400,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300)
      throw new Error(`Cerebras ${res.status}: ${errText}`)
    }
    return await res.json() as LlmResponse
  } finally {
    clearTimeout(timer)
  }
}

async function callGroq(messages: LlmMessage[]): Promise<LlmResponse> {
  if (GROQ_KEYS.length === 0) throw new Error('LLM_API_KEY not set')
  // Use the first key — multi-key rotation can be added later if needed.
  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${GROQ_KEYS[0]}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       'llama-3.1-8b-instant',
      messages,
      tools:       TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.1,
      max_tokens:  400,
    }),
  })
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300)
    throw new Error(`Groq ${res.status}: ${errText}`)
  }
  return await res.json() as LlmResponse
}

async function callLlmWithFallback(messages: LlmMessage[]): Promise<{ resp: LlmResponse; modelUsed: string }> {
  if (CEREBRAS_KEY) {
    try {
      const resp = await callCerebras(messages)
      return { resp, modelUsed: 'cerebras/llama3.3-70b' }
    } catch (err) {
      console.warn(`[VOICE-WORKER-AGENT] Cerebras failed, falling back: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const resp = await callGroq(messages)
  return { resp, modelUsed: 'groq/llama-3.1-8b-instant' }
}

// ── Notification building (post-write side effect) ─────────────────────────

const ACTION_TO_EVENT_TYPE: Record<string, NotificationType> = {
  created:     'appointment.created',
  cancelled:   'appointment.cancelled',
  rescheduled: 'appointment.rescheduled',
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runAgent(
  ctx:   ToolContext,
  input: AgentInput,
): Promise<AgentOutput> {
  const system   = buildSystemPrompt(input)
  const history  = input.history.map(m => ({ role: m.role, content: m.content })) as LlmMessage[]
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    ...history,
    { role: 'user',   content: input.text },
  ]

  // Per-turn dedup of (toolName + canonical args JSON)
  const executedFingerprints = new Set<string>()
  let actionPerformed         = false
  const pendingNotifications: AppointmentNotification[] = []
  let modelUsed               = 'unknown'
  let finalText               = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const { resp, modelUsed: m } = await callLlmWithFallback(messages)
    modelUsed = m

    const choice = resp.choices?.[0]?.message
    if (!choice) {
      finalText = ''
      break
    }

    // No tool calls → final response
    if (!choice.tool_calls?.length) {
      finalText = (choice.content ?? '').trim()
      messages.push({ role: 'assistant', content: finalText })
      break
    }

    // Append the assistant turn (with tool_calls) — required by the protocol
    messages.push({
      role:       'assistant',
      content:    choice.content ?? null,
      tool_calls: choice.tool_calls,
    })

    // Execute each tool call
    for (const tc of choice.tool_calls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        // Ignore malformed args — return error to LLM so it can correct
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.function.name,
          content:      'Error: argumentos inválidos (no es JSON válido).',
        })
        continue
      }

      // Stable fingerprint with sorted keys
      const sortedArgs = Object.keys(parsedArgs).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = parsedArgs[k]; return acc
      }, {})
      const fp = `${tc.function.name}::${JSON.stringify(sortedArgs)}`

      if (executedFingerprints.has(fp)) {
        console.warn(`[VOICE-WORKER-AGENT] Duplicate tool call blocked: ${tc.function.name}`)
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.function.name,
          content:      'Esta acción ya fue ejecutada en este turno con los mismos datos. NO la repitas. Sintetiza el resultado anterior y termina.',
        })
        continue
      }
      executedFingerprints.add(fp)

      const result = await executeTool(tc.function.name, parsedArgs, ctx)
      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        name:         tc.function.name,
        content:      result.result,
      })

      if (result.success && WRITE_TOOLS.has(tc.function.name)) {
        actionPerformed = true
        if (result.data) {
          const eventType = ACTION_TO_EVENT_TYPE[result.data.action]
          if (eventType) {
            pendingNotifications.push({
              eventId:     crypto.randomUUID(),
              type:        eventType,
              businessId:  ctx.businessId,
              userId:      ctx.userId,
              clientName:  result.data.clientName,
              serviceName: result.data.serviceName,
              date:        result.data.date,
              time:        result.data.time,
            })
          }
        }
      }
    }
  }

  // Safety net for empty responses after a successful action
  if (!finalText.trim() && actionPerformed) {
    finalText = 'Listo.'
  } else if (!finalText.trim()) {
    finalText = 'No te entendí bien, ¿puedes repetir?'
  }

  // Build clean history (only user + final assistant text — drop tool messages)
  const newHistory: AgentOutput['history'] = [
    ...input.history,
    { role: 'user',      content: input.text },
    { role: 'assistant', content: finalText  },
  ].slice(-30)

  return {
    text:                 finalText,
    actionPerformed,
    history:              newHistory,
    modelUsed,
    pendingNotifications,
  }
}
