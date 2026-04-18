/**
 * AI Agent for Appointment Scheduling — ReAct Loop Architecture
 *
 * Implements a multi-step reasoning loop (ReAct pattern) using Native JSON Tool Calling.
 *
 * Architecture:
 *  - Small model (llama-3.1-8b-instant) handles the decision/tool-calling loop (MAX_STEPS=3)
 *  - Large model (llama-3.3-70b-versatile) generates the final empathetic response
 *  - If DB rejects a booking (SLOT_CONFLICT), the LLM sees the error and self-corrects
 *
 * Exposes:
 *  - runAgentLoop    → ReAct loop: reasons, calls tools, returns final text
 *  - transcribeAudio → Groq Whisper STT
 *
 * Module map:
 *  - groq-client.ts   → LLM types, callLlm(), heliconeHeaders(), error classes
 *  - prompt-builder.ts → buildMinimalSystemPrompt(), renderBookingSuccessTemplate()
 *  - tool-executor.ts  → BOOKING_TOOLS, executeToolCall()
 *  - notifications.ts  → fireOwnerNotifications(), sendWhatsAppWithRetry()
 */

import type { BusinessRagContext } from "./types.ts"
import { addBreadcrumb, captureException } from "../_shared/sentry.ts"
import {
  checkCircuitBreaker,
  reportServiceFailure,
  reportServiceSuccess,
} from "./guards.ts"
import {
  callLlm,
  heliconeHeaders,
  LlmRateLimitError,
  CircuitBreakerError,
  SMALL_MODEL,
  LARGE_MODEL,
  WHISPER_MODEL,
  WHISPER_API_URL,
  MAX_STEPS,
} from "./groq-client.ts"
import type { AgentMessage } from "./groq-client.ts"
import { buildMinimalSystemPrompt, renderBookingSuccessTemplate } from "./prompt-builder.ts"
import { BOOKING_TOOLS, executeToolCall }                         from "./tool-executor.ts"

export { LlmRateLimitError, CircuitBreakerError }

// ── Output Sanitization ────────────────────────────────────────────────────────

function sanitizeOutput(text: string): string {
  if (!text) return text
  return text
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/<function>[\s\S]*?<\/function>/gi, '')
    .replace(/\[CONFIRM_[^\]]+\]/gi, '')
    .replace(/\{[\s\S]*?"(?:service_id|client_id|appointment_id|date|time)":[\s\S]*?\}/gi, '')
    .trim()
}

function containsInternalSyntax(text: string): boolean {
  return /<function[=\s>]|CONFIRM_|"service_id"|"client_id"|"appointment_id"/i.test(text)
}

const INTERNAL_SYNTAX_FALLBACK = 'Estoy verificando la información. ¿Podrías confirmarme?'

// ── Public API: Agent Loop ────────────────────────────────────────────────────

/**
 * Runs the ReAct agent loop for a WhatsApp message.
 *
 * Inner loop (SMALL_MODEL): decides whether to call a booking tool, executes it,
 * feeds the DB result back to the LLM, and retries if needed (up to MAX_STEPS).
 *
 * Final pass (LARGE_MODEL): generates an empathetic, on-brand response for the customer.
 *
 * @param userText     - Sanitized message text from the customer
 * @param context      - Full BusinessRagContext (services, history, booked slots, etc.)
 * @param customerName - Display name from WhatsApp
 * @param sender       - WhatsApp phone number (used for booking payload)
 */
export async function runAgentLoop(
  userText:     string,
  context:      BusinessRagContext,
  customerName: string,
  sender:       string,
): Promise<{ text: string; tokens: number; toolCallsTrace: unknown[] }> {
  const { business } = context

  // Cap history at 8 messages (~4 turns) to prevent unbounded token growth
  const cappedHistory = context.history.slice(-8)

  // Build initial messages array
  const messages: AgentMessage[] = [
    { role: 'system', content: buildMinimalSystemPrompt(context, customerName) },
    // Inject conversation history (convert 'model' role to 'assistant')
    ...cappedHistory.map(h => ({
      role:    (h.role === 'model' ? 'assistant' : h.role) as AgentMessage['role'],
      content: h.text,
    })),
    { role: 'user', content: userText },
  ]

  let totalTokens:    number    = 0
  let step:           number    = 0
  let actionPerformed = false
  let loopText:       string    = ''
  const toolCallsTrace: unknown[] = []

  // Deduplication guard: blocks the LLM from calling the same tool with identical
  // arguments twice in a single turn, which would create duplicate appointments.
  const executedToolFingerprints = new Set<string>()

  // ── ReAct Loop (SMALL_MODEL) ──────────────────────────────────────────────
  while (step < MAX_STEPS) {
    step++

    addBreadcrumb(`ReAct loop step ${step}/${MAX_STEPS}`, 'agent', 'info', {
      model:    SMALL_MODEL,
      business: business.name,
    })

    const { response, tokens } = await callLlm(
      SMALL_MODEL,
      messages,
      BOOKING_TOOLS,
      { tenant: business.slug ?? 'unknown', customer: customerName, loop_step: String(step) },
    )
    totalTokens += tokens

    const assistantMsg = response.choices?.[0]?.message
    if (!assistantMsg) break

    // ── Embedded function recovery ─────────────────────────────────────────
    if (assistantMsg.content && (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0)) {
      const match1 = assistantMsg.content.match(/<function=([a-z_]+)>([\s\S]*?)<\/function>/i)
      const match2 = assistantMsg.content.match(/<function>\s*([a-z_]+)\s*<\/function>\s*(\{[\s\S]*\})/i)
      let fnName = ''
      let argsRaw = ''
      
      if (match1) { fnName = match1[1] ?? ''; argsRaw = match1[2] ?? '' }
      else if (match2) { fnName = match2[1] ?? ''; argsRaw = match2[2] ?? '' }

      if (fnName) {
        addBreadcrumb(`LLM emitted embedded <function> syntax — recovering ${fnName}`, 'agent', 'warning')
        let argsValid = false
        try { JSON.parse(argsRaw); argsValid = true } catch {}
        
        if (argsValid) {
          assistantMsg.tool_calls = [{
            id:       `call_${Date.now()}`,
            type:     'function',
            function: { name: fnName, arguments: argsRaw },
          }]
          // Hide leaked content from LLM
          assistantMsg.content = null
        } else {
          loopText = INTERNAL_SYNTAX_FALLBACK
          break
        }
      }
    }

    // Add assistant turn to history (include tool_calls if present — required by API)
    messages.push({
      role:       'assistant',
      content:    assistantMsg.content ?? null,
      tool_calls: assistantMsg.tool_calls,
    })

    // No tool calls → LLM finished reasoning, capture text and break
    if (!assistantMsg.tool_calls?.length) {
      loopText = assistantMsg.content?.trim() ?? ''
      break
    }

    actionPerformed = true

    // Execute each tool call and feed results back
    for (const toolCall of assistantMsg.tool_calls) {
      const stepStart = Date.now()

      // Deduplication guard — same tool + same args in the same session = duplicate booking risk
      const fingerprint = `${toolCall.function.name}::${toolCall.function.arguments}`
      if (executedToolFingerprints.has(fingerprint)) {
        addBreadcrumb(`Duplicate tool call blocked: ${toolCall.function.name}`, 'agent', 'warning')
        messages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          name:         toolCall.function.name,
          content:      JSON.stringify({ success: false, error: 'DUPLICATE_CALL: esta acción ya fue ejecutada en este turno' }),
        })
        continue
      }
      executedToolFingerprints.add(fingerprint)

      let toolResult: string
      try {
        toolResult = await executeToolCall(toolCall, context, sender, customerName)
      } catch (err) {
        captureException(err, { stage: 'execute_tool_call', tool: toolCall.function.name })
        toolResult = JSON.stringify({ success: false, error: 'TOOL_EXECUTION_ERROR: error interno al ejecutar la acción' })
      }

      const parsedResult = (() => { try { return JSON.parse(toolResult) } catch { return toolResult } })()

      toolCallsTrace.push({
        step,
        tool:        toolCall.function.name,
        args:        (() => { try { return JSON.parse(toolCall.function.arguments) } catch { return toolCall.function.arguments } })(),
        result:      parsedResult,
        duration_ms: Date.now() - stepStart,
        success:     parsedResult?.success !== false,
      })

      messages.push({
        role:         'tool',
        tool_call_id: toolCall.id,
        name:         toolCall.function.name,
        content:      toolResult,
      })
    }
  }

  // Detect loop exhaustion: hit MAX_STEPS while still executing tools (no clean break)
  const loopExhausted = step === MAX_STEPS && actionPerformed && !loopText

  if (loopExhausted) {
    captureException(
      new Error(`ReAct loop exhausted after ${MAX_STEPS} steps`),
      {
        stage:           'loop_exhausted',
        business_id:     business.id,
        steps_taken:     step,
        tools_attempted: (toolCallsTrace as Array<{ tool: string }>).map(t => t.tool).join(' → '),
      }
    )
    addBreadcrumb('Loop exhausted — escalating to LARGE_MODEL', 'agent', 'warning')
  }

  addBreadcrumb(`ReAct loop completed in ${step} step(s)`, 'agent', 'info', {
    total_tokens_so_far: totalTokens,
    action_performed:    actionPerformed,
    loop_exhausted:      loopExhausted,
  })

  // ── Final Pass (LARGE_MODEL): empathetic response ─────────────────────────
  // Only invoked when tools were executed (booking actions need on-brand confirmation)
  // or when the loop exited without generating any text (edge case: MAX_STEPS hit).
  // Pure conversational messages answered by the 8B skip this to save tokens.
  let finalText: string

  // Check if last tool call succeeded — if so, skip LARGE_MODEL entirely using template
  const lastToolMsg    = [...messages].reverse().find(m => m.role === 'tool')
  const lastToolParsed = lastToolMsg ? (() => { try { return JSON.parse(lastToolMsg.content ?? '') } catch { return null } })() : null
  const lastTrace      = toolCallsTrace[toolCallsTrace.length - 1] as { tool: string } | undefined

  if (actionPerformed && lastToolParsed?.success === true && !loopExhausted) {
    // Tool succeeded → use predefined template, skip LARGE_MODEL entirely
    finalText = renderBookingSuccessTemplate(
      lastTrace?.tool ?? '',
      lastToolParsed,
      business.timezone,
    )
    addBreadcrumb('Skipped LARGE_MODEL (success template used)', 'agent', 'info', { tool: lastTrace?.tool })
  } else if (actionPerformed || !loopText) {
    // Tool failed or loop exhausted → LARGE_MODEL explains the error naturally
    const personality = business.settings.ai_personality ?? 'amable, profesional y muy breve'

    messages.push({
      role:    'system',
      content: `El trabajo administrativo está completo. Ahora responde al cliente de forma cálida y natural en español.
Personalidad: ${personality}.
Sé conciso: máximo 2-3 oraciones.
NUNCA menciones UUIDs, REF#, IDs técnicos ni detalles de sistema al cliente.
Si se creó, reagendó o canceló una cita, confírmalo de forma celebratoria y breve.`,
    })

    const { response: finalRes, tokens: finalTokens } = await callLlm(
      LARGE_MODEL,
      messages,
      [],
      { tenant: business.slug ?? 'unknown', customer: customerName, loop_step: 'final' },
      true, // enableCache: empathetic responses are more cacheable
    )
    totalTokens += finalTokens

    finalText = finalRes.choices?.[0]?.message?.content?.trim() ?? ''
    if (!finalText) {
      if (loopExhausted) {
        // Loop exhausted AND final model returned nothing — return user-friendly message, no throw
        addBreadcrumb('Final pass empty after loop exhaustion — returning graceful fallback', 'agent', 'error')
        return {
          text:           'Intenté varias veces procesar tu solicitud pero no pude completarla. Por favor, intenta de nuevo en un momento o escríbenos directamente.',
          tokens:         totalTokens,
          toolCallsTrace,
        }
      }
      // Normal (non-exhaustion) final pass failure → throw so Sentry/DLQ capture it
      addBreadcrumb('LARGE_MODEL returned empty final response', 'agent', 'error')
      throw new Error('Respuesta vacía del LLM en el paso final')
    }
  } else {
    // 8B already produced a complete conversational response — use it directly
    finalText = loopText
    addBreadcrumb('Skipped LARGE_MODEL pass (conversational response from 8B)', 'agent', 'info')
  }

  addBreadcrumb('Agent loop finished', 'agent', 'info', { total_tokens: totalTokens, steps: step })

  finalText = sanitizeOutput(finalText)
  if (containsInternalSyntax(finalText)) {
    addBreadcrumb('Internal syntax detected after sanitization — using fallback', 'agent', 'error', {
      snippet: finalText.slice(0, 100)
    })
    finalText = INTERNAL_SYNTAX_FALLBACK
  }

  return { text: finalText, tokens: totalTokens, toolCallsTrace }
}

// ── Public API: Audio Transcription ───────────────────────────────────────────

/**
 * Transcribes a voice note buffer to text using Groq Whisper.
 *
 * @param buffer   - Raw audio bytes (ogg/mp4/webm — whatever Meta sends)
 * @param mimeType - MIME type from Meta (e.g. 'audio/ogg; codecs=opus')
 */
export async function transcribeAudio(buffer: ArrayBuffer, mimeType: string): Promise<{ text: string | null; tokens: number }> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('LLM_API_KEY no configurada')

  // Normalize MIME: strip codec suffix (e.g. 'audio/ogg; codecs=opus' → 'audio/ogg').
  // Groq Whisper rejects the codec suffix in the Content-Type header of the multipart part,
  // causing silent 400/422 failures on WhatsApp voice notes from Android devices.
  const cleanMimeType = mimeType.split(';')[0].trim()

  // Map to Groq-supported file extensions (Groq uses the filename extension for format detection).
  const MIME_TO_EXT: Readonly<Record<string, string>> = {
    'audio/ogg':  'oga',   // OGG Opus (WhatsApp Android PTT)
    'audio/mp4':  'm4a',   // WhatsApp iOS voice notes
    'audio/mpeg': 'mp3',
    'audio/wav':  'wav',
    'audio/webm': 'webm',
    'audio/aac':  'm4a',
    'audio/amr':  'amr',
  }
  const ext      = MIME_TO_EXT[cleanMimeType] ?? (cleanMimeType.split('/')[1] ?? 'oga')
  const filename = `voice.${ext}`

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: cleanMimeType }), filename)
  form.append('model', WHISPER_MODEL)
  form.append('language', 'es')
  form.append('response_format', 'text')

  addBreadcrumb('Calling Whisper API', 'llm', 'info', { model: WHISPER_MODEL, mimeType })

  const serviceName = 'GROQ_WHISPER'
  if (!(await checkCircuitBreaker(serviceName))) {
    throw new CircuitBreakerError(serviceName)
  }

  let res: Response
  try {
    res = await fetch(WHISPER_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...heliconeHeaders({ type: 'audio-transcription' }),
      },
      body: form,
    })
  } catch (err) {
    await reportServiceFailure(serviceName)
    throw err
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
  }

  if (!res.ok) {
    if (res.status >= 500) await reportServiceFailure(serviceName)
    throw new Error(`Whisper API error: ${await res.text()}`)
  }

  await reportServiceSuccess(serviceName)

  const transcript      = (await res.text()).trim()
  const estimatedTokens = transcript ? 50 + transcript.split(/\s+/).length : 0

  return { text: transcript || null, tokens: estimatedTokens }
}
