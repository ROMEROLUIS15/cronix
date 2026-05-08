/**
 * Agent loop — Groq Llama 3.3 70B Versatile with native tool calling.
 *
 * Manual implementation of the OpenAI-compatible tool-calling protocol:
 *   1. Send messages + tool defs to LLM
 *   2. If response has tool_calls, execute each, append tool messages
 *   3. Loop until LLM returns plain text (or MAX_STEPS exhausted)
 *
 * Per-turn deduplication: same (toolName + args) blocked. Prevents
 * duplicate bookings if the model loops on the same tool call.
 *
 * Provider strategy:
 *   1. Groq llama-3.3-70b-versatile primary  (~3-4s, free, better prose)
 *   2. Groq llama-3.1-8b-instant fallback    (~0.5s, free, on 70B failure)
 *
 * Required env vars:
 *   LLM_API_KEY  (Groq — comma-separated keys for rotation)
 */

import { buildSystemPrompt }                          from './prompt.ts'
import { TOOL_DEFINITIONS, WRITE_TOOLS, executeTool, type ToolContext } from './tools.ts'
import type { AgentInput, AgentOutput, LlmMessage, AppointmentNotification, NotificationType } from './types.ts'

// ── Provider config ────────────────────────────────────────────────────────
//
// Cerebras was removed: the free tier lists models in /v1/models but rejects
// them at the chat endpoint (gpt-oss-120b → 404, llama-3.3-70b → 404).
// We rely on Groq exclusively. Groq llama-3.3-70b-versatile delivers similar
// quality to Cerebras at ~3-4s instead of ~1s — perfectly fine inside the
// 150s Edge Function budget. To re-add Cerebras: confirm a working model id
// on the user's plan, then restore the Cerebras attempt in callLlmWithFallback.

const GROQ_KEYS = (Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY') ?? '')
  .split(',').map(k => k.trim()).filter(Boolean)

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

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

/**
 * Single-attempt Groq call with one key + a chosen model.
 * Status code is preserved on the thrown error so the caller can choose to
 * rotate keys (429) vs bail (other errors).
 */
async function callGroqOnce(
  messages: LlmMessage[],
  key:      string,
  model:    string,
): Promise<LlmResponse> {
  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      tools:       TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.1,
      max_tokens:  400,
    }),
  })
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300)
    const err = new Error(`Groq[${model}] ${res.status}: ${errText}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return await res.json() as LlmResponse
}

/**
 * Calls Groq with a specific model and key rotation. On 429, immediately tries
 * the next key. Non-429 errors propagate up so the caller can fall back further.
 *
 * Free-tier capacity (per model, per key):
 *   llama-3.3-70b-versatile  → 12000 TPM
 *   llama-3.1-8b-instant     →  6000 TPM
 * With 3 keys = 36000 TPM aggregate for 70B, ample for the validation MVP.
 */
async function callGroq(messages: LlmMessage[], model: string): Promise<LlmResponse> {
  if (GROQ_KEYS.length === 0) throw new Error('LLM_API_KEY not set')
  let lastErr: unknown = null
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    try {
      return await callGroqOnce(messages, GROQ_KEYS[i]!, model)
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number }).status
      if (status === 429 && i < GROQ_KEYS.length - 1) {
        console.warn(`[VOICE-WORKER-AGENT] Groq[${model}] key ${i + 1}/${GROQ_KEYS.length} hit 429 — rotating`)
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('All Groq keys exhausted')
}

/**
 * Provider fallback chain — 70B primary for natural-language quality:
 *   1. Groq llama-3.3-70b-versatile (~3-4s)  — primary: better prose synthesis
 *   2. Groq llama-3.1-8b-instant    (~0.5s)  — fallback only on 70B failure
 *
 * Earlier we saw 70B respond "no hay citas" when the tool returned found=4.
 * Root cause turned out to be the QUERY, not the model: the tool didn't
 * follow the appointment_services junction table, so service.name came back
 * null, the formatted result looked like "10:00 cliente -" with no service,
 * and the LLM (any LLM) interpreted that as missing data. With the query
 * fixed (see tools.ts → getAppointmentsByDate), the 70B's natural prose
 * comes through cleanly.
 */
async function callLlmWithFallback(messages: LlmMessage[]): Promise<{ resp: LlmResponse; modelUsed: string }> {
  try {
    const resp = await callGroq(messages, 'llama-3.3-70b-versatile')
    return { resp, modelUsed: 'groq/llama-3.3-70b-versatile' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[VOICE-WORKER-AGENT] Groq 70B failed, falling back to 8B: ${reason}`)
  }
  const resp = await callGroq(messages, 'llama-3.1-8b-instant')
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
