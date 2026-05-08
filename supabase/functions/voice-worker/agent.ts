/**
 * Agent loop — provider-agnostic.
 *
 * Manual implementation of the OpenAI-compatible tool-calling protocol:
 *   1. Send messages + tool defs to LLM (via the configured provider)
 *   2. If response has tool_calls, execute each, append tool messages
 *   3. Loop until LLM returns plain text (or MAX_STEPS exhausted)
 *
 * Per-turn deduplication: same (toolName + args) blocked. Prevents
 * duplicate bookings if the model loops on the same tool call.
 *
 * Provider selection is env-driven (LLM_PROVIDER):
 *   "groq"        → Groq only (default)
 *   "gemini"      → Gemini only
 *   "gemini,groq" → Gemini primary, Groq fallback on error
 *
 * Required env vars (depending on selection):
 *   LLM_API_KEY     — Groq (comma-separated for key rotation)
 *   GEMINI_API_KEY  — Gemini
 */

import { buildSystemPrompt }                          from './prompt.ts'
import { TOOL_DEFINITIONS, WRITE_TOOLS, executeTool, type ToolContext } from './tools.ts'
import { getProvider }                                from './providers/registry.ts'
import type { NeutralMessage, NeutralTool } from './providers/ILLMProvider.ts'
import type { AgentInput, AgentOutput, AppointmentNotification, NotificationType } from './types.ts'

const MAX_STEPS = 3   // 1-2 tool calls + final synthesis fits comfortably

// ── Adapters: voice-worker types → neutral provider types ────────────────

/**
 * The TOOL_DEFINITIONS in tools.ts already match the neutral schema shape.
 * This adapter is a structural cast so downstream changes to NeutralTool
 * remain a single point of breakage instead of being scattered.
 */
function toNeutralTools(): NeutralTool[] {
  return TOOL_DEFINITIONS.map(t => ({
    name:        t.function.name,
    description: t.function.description,
    parameters:  t.function.parameters as NeutralTool['parameters'],
  }))
}

// ── Notification building (post-write side effect) ───────────────────────

const ACTION_TO_EVENT_TYPE: Record<string, NotificationType> = {
  created:     'appointment.created',
  cancelled:   'appointment.cancelled',
  rescheduled: 'appointment.rescheduled',
}

// ── Public API ────────────────────────────────────────────────────────────

export async function runAgent(
  ctx:   ToolContext,
  input: AgentInput,
): Promise<AgentOutput> {
  const provider = getProvider()
  const tools    = toNeutralTools()
  const system   = buildSystemPrompt(input)

  // Conversation history → neutral messages
  const messages: NeutralMessage[] = [
    ...input.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: input.text },
  ]

  // Per-turn dedup of (toolName + canonical args JSON)
  const executedFingerprints = new Set<string>()
  let actionPerformed         = false
  const pendingNotifications: AppointmentNotification[] = []
  let modelUsed               = 'unknown'
  let finalText               = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await provider.chat({
      system,
      messages,
      tools,
      temperature:     0.1,
      maxOutputTokens: 400,
    })
    modelUsed = resp.modelUsed

    // No tool calls → final response
    if (resp.toolCalls.length === 0) {
      finalText = (resp.content ?? '').trim()
      messages.push({ role: 'assistant', content: finalText })
      break
    }

    // Append the assistant turn (with tool_calls) — required by the protocol
    messages.push({
      role:       'assistant',
      content:    resp.content,
      tool_calls: resp.toolCalls,
    })

    // Execute each tool call
    for (const tc of resp.toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>
      } catch {
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      'Error: argumentos inválidos (no es JSON válido).',
        })
        continue
      }

      // Stable fingerprint with sorted keys
      const sortedArgs = Object.keys(parsedArgs).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = parsedArgs[k]; return acc
      }, {})
      const fp = `${tc.name}::${JSON.stringify(sortedArgs)}`

      if (executedFingerprints.has(fp)) {
        console.warn(`[VOICE-WORKER-AGENT] Duplicate tool call blocked: ${tc.name}`)
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      'Esta acción ya fue ejecutada en este turno con los mismos datos. NO la repitas. Sintetiza el resultado anterior y termina.',
        })
        continue
      }
      executedFingerprints.add(fp)

      const result = await executeTool(tc.name, parsedArgs, ctx)
      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        name:         tc.name,
        content:      result.result,
      })

      if (result.success && WRITE_TOOLS.has(tc.name)) {
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
