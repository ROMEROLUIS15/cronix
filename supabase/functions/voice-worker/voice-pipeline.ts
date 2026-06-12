/**
 * voice-pipeline.ts — Voice agent decomposed into pipeline steps.
 *
 * The prelude (trace start, guard setup, fast path detection) stays in agent.ts
 * because it has early returns. The pipeline handles the LLM loop and output
 * building only.
 */

import { Pipeline } from "../_shared/pipeline/index.ts"
import { shortHash } from "../_shared/observability/index.ts"
import { buildAppointmentEventId } from "../_shared/notifications/event-id.ts"
import type { ToolContext } from './core/tool-context.ts'
import type { NeutralMessage, NeutralTool } from './providers/ILLMProvider.ts'
import type { AgentInput, AgentOutput, AppointmentNotification, NotificationType } from './types.ts'
import {
  executeByName, getToolDefinitions, WRITE_CAPABILITIES, BYPASS_CAPABILITIES,
} from './capabilities/_shared/registry.ts'
import { coerceToolArgs } from './core/tool-args.ts'

// ── Re-export shared utilities (moved from agent.ts) ─────────────────────────

export const DATE_TOOLS = new Set([
  'get_appointments_by_date',
  'get_available_slots',
  'smart_schedule',
  'cancel_booking',
  'reschedule_booking',
])

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export interface DateOverride {
  date:   string
  reason: string
}

export function detectTemporalIntent(userText: string, today: string): DateOverride | null {
  const t = userText.toLowerCase()
  const PASADO_MANANA = /\bpasado\s+ma[ñn]ana\b/
  const MANANA        = /\bma[ñn]ana\b/
  const HOY           = /\bhoy\b/

  if (PASADO_MANANA.test(t)) return { date: addDaysIso(today, 2), reason: '"pasado mañana"' }
  if (MANANA.test(t))        return { date: addDaysIso(today, 1), reason: '"mañana"' }
  if (HOY.test(t))           return { date: today,                reason: '"hoy"' }
  return null
}

export const ACTION_TO_EVENT_TYPE: Record<string, NotificationType> = {
  created:     'appointment.created',
  cancelled:   'appointment.cancelled',
  rescheduled: 'appointment.rescheduled',
}

const MAX_STEPS = 3

// ── Adapter: capability definitions → neutral provider tool shape ────────────

export function toNeutralTools(): NeutralTool[] {
  return getToolDefinitions().map(t => ({
    name:        t.function.name,
    description: t.function.description,
    parameters:  t.function.parameters as NeutralTool['parameters'],
  }))
}

// ── Pipeline Context ─────────────────────────────────────────────────────────

export interface VoiceLlmContext { [key: string]: unknown
  provider:     { chat: (opts: { system: string; messages: NeutralMessage[]; tools: NeutralTool[]; temperature: number; maxOutputTokens: number }) => Promise<{ modelUsed: string; toolCalls: Array<{ id: string; name: string; arguments: string }>; content: string | null; tokensUsed?: number }> }
  tools:        NeutralTool[]
  system:       string
  dateOverride: DateOverride | null
  ctx:          ToolContext
  input:        AgentInput
  trace:        { recordLlmStep: (d: { model: string; latencyMs: number; tokens?: number; hadToolCalls: boolean }) => void; recordToolCall: (d: { tool: string; durationMs: number; status: string; argsFingerprint: string; errorCode?: string }) => void }
}

export interface VoiceLlmResult { [key: string]: unknown
  finalText:            string
  actionPerformed:      boolean
  modelUsed:            string
  pendingNotifications: AppointmentNotification[]
  lastRefCandidate:     AgentOutput['lastRefCandidate']
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function applyDateOverride(
  tc: { name: string; arguments: string },
  args: Record<string, unknown>,
  dateOverride: DateOverride | null,
): void {
  if (!dateOverride || !DATE_TOOLS.has(tc.name) || typeof args.date !== 'string') return
  if (args.date !== dateOverride.date) {
    console.warn(
      `[VOICE-WORKER-AGENT] Date guard: user said ${dateOverride.reason} ` +
      `but LLM passed date=${args.date} → overriding to ${dateOverride.date}`,
    )
    args.date = dateOverride.date
  }
}

function buildToolFingerprint(args: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = args[k]; return acc
  }, {}))
}

export function buildNotificationFromWrite(
  result: { data?: { action: string; clientName: string; serviceName: string; date: string; time: string; appointmentId: string } },
  businessId: string,
  userId: string,
): { notification?: AppointmentNotification; lastRef: AgentOutput['lastRefCandidate'] } {
  if (!result.data) return { lastRef: null }

  const eventType = ACTION_TO_EVENT_TYPE[result.data.action]
  const notification = eventType
    ? {
        // Deterministic id (shared contract) — a QStash/LLM retry of the same
        // write produces the same eventId, so the notifications.event_id UNIQUE
        // constraint dedups it instead of inserting a duplicate bell.
        eventId:     buildAppointmentEventId(
          result.data.action as 'created' | 'rescheduled' | 'cancelled',
          businessId, result.data.appointmentId, result.data.date, result.data.time,
        ),
        type:        eventType,
        businessId,
        userId,
        clientName:  result.data.clientName,
        serviceName: result.data.serviceName,
        date:        result.data.date,
        time:        result.data.time,
      }
    : undefined

  const lastRef = result.data.action === 'cancelled'
    ? null
    : { appointmentId: result.data.appointmentId, clientName: result.data.clientName, serviceName: result.data.serviceName, date: result.data.date, time: result.data.time }

  return { notification: notification as AppointmentNotification | undefined, lastRef }
}

function shouldBypassSynthesis(
  toolCalls: Array<{ name: string }>,
  lastResultText: string | null,
): boolean {
  return toolCalls.length === 1 && lastResultText !== null && BYPASS_CAPABILITIES.has(toolCalls[0]!.name)
}

// ── Step 1: LLM Loop ──────────────────────────────────────────────────────────

async function stepLlmLoop(ctx: VoiceLlmContext): Promise<VoiceLlmResult> {
  const messages: NeutralMessage[] = [
    ...ctx.input.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: ctx.input.text },
  ]

  const executedFingerprints = new Set<string>()
  let actionPerformed         = false
  const pendingNotifications: AppointmentNotification[] = []
  let modelUsed               = 'unknown'
  let finalText               = ''
  let lastRefCandidate: AgentOutput['lastRefCandidate'] = null

  for (let step = 0; step < MAX_STEPS; step++) {
    const llmStart = Date.now()
    const resp = await ctx.provider.chat({
      system:         ctx.system,
      messages,
      tools:          ctx.tools,
      temperature:    0.1,
      maxOutputTokens: 400,
    })
    modelUsed = resp.modelUsed
    ctx.trace.recordLlmStep({
      model:        resp.modelUsed,
      latencyMs:    Date.now() - llmStart,
      tokens:       resp.tokensUsed,
      hadToolCalls: resp.toolCalls.length > 0,
    })

    if (resp.toolCalls.length === 0) {
      finalText = (resp.content ?? '').trim()
      messages.push({ role: 'assistant', content: finalText })
      break
    }

    messages.push({
      role:       'assistant',
      content:    resp.content,
      tool_calls: resp.toolCalls,
    })

    let lastResultText:    string | null = null
    let successfulCallCount = 0

    for (const tc of resp.toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = coerceToolArgs(JSON.parse(tc.arguments))
      } catch {
        messages.push({
          role: 'tool', tool_call_id: tc.id, name: tc.name,
          content: 'Error: argumentos inválidos (no es JSON válido).',
        })
        continue
      }

      applyDateOverride(tc, parsedArgs, ctx.dateOverride)

      const sortedArgs = buildToolFingerprint(parsedArgs)
      const fp = `${tc.name}::${JSON.stringify(sortedArgs)}`

      if (executedFingerprints.has(fp)) {
        console.warn(`[VOICE-WORKER-AGENT] Duplicate tool call blocked: ${tc.name}`)
        messages.push({
          role: 'tool', tool_call_id: tc.id, name: tc.name,
          content: 'Esta acción ya fue ejecutada en este turno con los mismos datos. NO la repitas. Sintetiza el resultado anterior y termina.',
        })
        continue
      }
      executedFingerprints.add(fp)

      const toolStart = Date.now()
      const result = await executeByName(tc.name, parsedArgs, ctx.ctx)
      ctx.trace.recordToolCall({
        tool: tc.name, durationMs: Date.now() - toolStart,
        status: result.success ? 'success' : 'error',
        argsFingerprint: await shortHash(JSON.stringify(sortedArgs)),
        errorCode: result.success ? undefined : 'TOOL_FAILURE',
      })
      messages.push({
        role: 'tool', tool_call_id: tc.id, name: tc.name,
        content: result.result,
      })

      if (result.success) successfulCallCount++
      if (BYPASS_CAPABILITIES.has(tc.name) && result.result) {
        lastResultText = result.result
      }

      if (result.success && WRITE_CAPABILITIES.has(tc.name)) {
        actionPerformed = true
        const { notification, lastRef } = buildNotificationFromWrite(result, ctx.ctx.businessId, ctx.ctx.userId)
        if (notification) pendingNotifications.push(notification)
        if (lastRef !== undefined) lastRefCandidate = lastRef
      }
    }

    if (shouldBypassSynthesis(resp.toolCalls, lastResultText)) {
      finalText = lastResultText!
      console.log(`[VOICE-WORKER-AGENT] Bypassing LLM synthesis (success=${successfulCallCount === 1})`)
      break
    }
  }

  if (!finalText.trim() && actionPerformed) {
    finalText = 'Listo.'
  } else if (!finalText.trim()) {
    finalText = 'No te entendí bien, ¿puedes repetir?'
  }

  return { finalText, actionPerformed, modelUsed, pendingNotifications, lastRefCandidate }
}

// ── Pipeline Builder ─────────────────────────────────────────────────────────

export function buildVoicePipeline() {
  return new Pipeline<VoiceLlmContext>('voice-llm-flow')
    .step('llm-loop', stepLlmLoop)
}
