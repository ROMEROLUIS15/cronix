/**
 * message-pipeline.ts — Core WhatsApp processing decomposed into 4 pipeline steps.
 *
 * Each step is a focused, independently testable function that receives the
 * accumulated context and returns a partial object merged downstream.
 *
 * The prelude (signature verification, rate limits, business routing) stays in
 * message-handler.ts because those are fast, early-return checks that don't
 * benefit from pipeline orchestration.
 */

import { Pipeline }                    from "../_shared/pipeline/index.ts"
import type { BusinessRagContext, WaBusinessSettings, ServiceRow, ClientRow,
              ActiveAppointmentRow, ChatHistoryItem, BookedSlot } from "./types.ts"
import { runAgentLoop, LlmRateLimitError, CircuitBreakerError }   from "./ai-agent.ts"
import { sendWhatsAppMessage }                                   from "./whatsapp.ts"
import { trackTokenUsage }                                       from "./guards.ts"
import { getBusinessServices, getClientByPhone, getActiveAppointments,
         getConversationHistory, getBookedSlots }                from "./context-fetcher.ts"
import { logInteraction }                                        from "./audit.ts"
import { captureException, addBreadcrumb }                       from "../_shared/sentry.ts"

// ── Agent error wrappers (caught outside pipeline for retry logic) ────────────

export class AgentRetryError extends Error {
  constructor(public retryAfter: number) { super('Agent retry'); this.name = 'AgentRetryError' }
}
export class AgentCircuitBreakerError extends Error {
  constructor() { super('Agent circuit breaker'); this.name = 'AgentCircuitBreakerError' }
}
export class AgentTransientError extends Error {
  constructor() { super('Agent transient'); this.name = 'AgentTransientError' }
}

// ── Pipeline Context ──────────────────────────────────────────────────────────

// A `type` alias (not `interface`) so it satisfies the Pipeline's `Record<string, unknown>`
// constraint — interfaces lack the implicit index signature that closed object types have.
export type WhatsAppPipelineInput = {
  sender:        string
  customerName:  string
  text:          string
  // timezone may be null here; stepFetchContext defaults it to 'UTC' before use.
  business:      import("./types.ts").BusinessRow
}

export interface WhatsAppPipelineOutput {
  agentResult: { text: string; tokens: number; toolCallsTrace: unknown[] }
  context:     BusinessRagContext
}

// ── Step 1: Fetch Business Context ────────────────────────────────────────────

async function stepFetchContext(ctx: WhatsAppPipelineInput) {
  const timezone = ctx.business.timezone ?? 'UTC'

  const [services, client] = await Promise.all([
    getBusinessServices(ctx.business.id),
    getClientByPhone(ctx.business.id, ctx.sender),
  ])

  const [activeAppointments, history, bookedSlots] = await Promise.all([
    client ? getActiveAppointments(ctx.business.id, client.id) : Promise.resolve([] as ActiveAppointmentRow[]),
    getConversationHistory(ctx.business.id, ctx.sender, 6),
    getBookedSlots(ctx.business.id, timezone),
  ])

  addBreadcrumb('Context fetched', 'database', 'info', {
    has_client:          !!client,
    active_appointments: activeAppointments.length,
    history_items:       history.length,
  })

  const ragContext: BusinessRagContext = {
    business: {
      id:       ctx.business.id,
      name:     ctx.business.name,
      timezone,
      phone:    ctx.business.phone ?? null,
      address:  ctx.business.address ?? null,
      slug:     ctx.business.slug ?? null,
      settings: (ctx.business.settings ?? {}) as WaBusinessSettings,
    },
    services:           services as ServiceRow[],
    client:             client as ClientRow | null,
    activeAppointments: activeAppointments as ActiveAppointmentRow[],
    history:            history as ChatHistoryItem[],
    bookedSlots:        bookedSlots as BookedSlot[],
  }

  return { timezone, context: ragContext }
}

// ── Step 2: Run AI Agent ──────────────────────────────────────────────────────

async function stepRunAgent(ctx: WhatsAppPipelineInput & { context: BusinessRagContext }) {
  addBreadcrumb('Starting ReAct agent loop', 'llm', 'info', { model: 'llama-3.1-8b-instant' })

  let agentResult: { text: string; tokens: number; toolCallsTrace: unknown[] }
  try {
    agentResult = await runAgentLoop(ctx.text, ctx.context, ctx.customerName, ctx.sender)
  } catch (err) {
    if (err instanceof LlmRateLimitError) throw new AgentRetryError(err.retryAfterSecs)
    if (err instanceof CircuitBreakerError) throw new AgentCircuitBreakerError()
    captureException(err, { stage: 'ai_processing_failure', sender: ctx.sender, prompt_length: ctx.text?.length })
    throw new AgentTransientError()
  }

  if (agentResult.tokens > 0) {
    await trackTokenUsage(ctx.business.id, agentResult.tokens)
  }

  addBreadcrumb('Agent loop finished', 'llm', 'info', {
    response_length: agentResult.text.length,
    tokens:          agentResult.tokens,
  })

  return { agentResult }
}

// ── Step 3: Send WhatsApp Response ────────────────────────────────────────────

async function stepSendResponse(ctx: WhatsAppPipelineInput & { agentResult: { text: string } }) {
  await sendWhatsAppMessage(ctx.sender, ctx.agentResult.text)
  return {}
}

// ── Step 4: Log Interaction ───────────────────────────────────────────────────

async function stepLogInteraction(ctx: WhatsAppPipelineInput & { agentResult: { text: string; toolCallsTrace: unknown[] } }) {
  await logInteraction({
    business_id:  ctx.business.id,
    sender_phone: ctx.sender,
    message_text: ctx.text,
    ai_response:  ctx.agentResult.text,
    tool_calls:   ctx.agentResult.toolCallsTrace.length > 0
      ? { steps: ctx.agentResult.toolCallsTrace }
      : undefined,
  })
  return {}
}

// ── Pipeline Builder ──────────────────────────────────────────────────────────

export function buildWhatsAppPipeline() {
  return new Pipeline<WhatsAppPipelineInput>('whatsapp-core')
    .step('fetch-context', stepFetchContext)
    .step('run-agent', stepRunAgent)
    .step('send-response', stepSendResponse)
    .step('log-interaction', stepLogInteraction)
}
