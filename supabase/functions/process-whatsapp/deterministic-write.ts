/**
 * deterministic-write.ts — Executes a booking write with code-derived, validated args.
 *
 * The 8B never chose these args (booking-flow did), so this reuses executeToolCall to
 * get the SAME rate-limit, adapter validation, cache invalidation and notification
 * pipeline as the LLM route — but skips the constitutional reviewer on purpose (it vets
 * LLM hallucinations; here the args are deterministic, so running it would add an LLM
 * call and defeat the 0-token path).
 */

import type { BusinessRagContext } from "./types.ts"
import { captureException } from "../_shared/sentry.ts"
import type { ToolCall } from "./groq-client.ts"
import { executeToolCall } from "./tool-executor.ts"
import { selectFinalResponse } from "./final-response.ts"
import { scrubPII } from "./output-sanitizer.ts"
import { memoryEngine, tracer } from "./agent-singletons.ts"
import { shortHash } from "../_shared/observability/index.ts"
import type { MemoryScope } from "../_shared/memory/contracts.ts"
import type { TurnResult } from "./turn-context.ts"

export type DeterministicWrite =
  | { kind: 'execute';           serviceId: string;     serviceName: string; date: string;    time: string }
  | { kind: 'executeCancel';     appointmentId: string; serviceName: string; date: string;    time: string }
  | { kind: 'executeReschedule'; appointmentId: string; serviceName: string; newDate: string; newTime: string }

/** Maps a directive to its write tool + args. */
function toToolCall(directive: DeterministicWrite): { toolName: string; args: Record<string, string> } {
  return directive.kind === 'execute'
    ? { toolName: 'confirm_booking',    args: { service_id: directive.serviceId, date: directive.date, time: directive.time } }
  : directive.kind === 'executeCancel'
    ? { toolName: 'cancel_booking',     args: { appointment_id: directive.appointmentId } }
    : { toolName: 'reschedule_booking', args: { appointment_id: directive.appointmentId, new_date: directive.newDate, new_time: directive.newTime } }
}

export async function executeDeterministicWrite(
  directive:    DeterministicWrite,
  context:      BusinessRagContext,
  sender:       string,
  customerName: string,
  memoryScope:  MemoryScope,
  userText:     string,
): Promise<TurnResult> {
  const { business } = context
  const { toolName, args } = toToolCall(directive)

  const argsJson = JSON.stringify(args)
  const trace = tracer.start(
    { businessId: business.id, channel: 'whatsapp', actorKind: 'client_phone', actorKey: sender },
    await shortHash(`${toolName}|${argsJson}`),
    { deterministic: true, path: 'write_execute', tool: toolName },
  )

  const synthetic: ToolCall = {
    id:       `det_${Date.now()}`,
    type:     'function',
    function: { name: toolName as ToolCall['function']['name'], arguments: argsJson },
  }

  const stepStart = Date.now()
  let toolResult: string
  try {
    toolResult = await executeToolCall(synthetic, context, sender, customerName, undefined)
  } catch (err) {
    captureException(err, { stage: 'deterministic_write', tool: toolName })
    toolResult = JSON.stringify({ success: false, error: 'TOOL_EXECUTION_ERROR' })
  }

  const parsed  = (() => { try { return JSON.parse(toolResult) } catch { return null } })()
  const success = parsed?.success === true
  const errCode = success ? '' : String(parsed?.error ?? '')

  trace.recordToolCall({
    tool:            toolName,
    durationMs:      Date.now() - stepStart,
    status:          success ? 'success' : errCode.includes('RATE_LIMIT') ? 'rate_limited' : 'error',
    argsFingerprint: await shortHash(argsJson),
    errorCode:       success ? undefined : (errCode || 'UNKNOWN').slice(0, 64),
  })

  const finalText = selectFinalResponse(true, parsed, '', { tool: toolName }, business.timezone)

  if (success) {
    void memoryEngine.write(memoryScope, {
      kind:     'episodic',
      content:  `Cliente ${customerName}: ${toolName} — ${directive.serviceName}`,
      metadata: { tool: toolName, result: parsed },
      ttlDays:  180,
    })
  }

  await trace.finish({
    outcome:      success ? 'success' : errCode.includes('RATE_LIMIT') ? 'rate_limited' : 'failure',
    errorCode:    errCode ? errCode.slice(0, 64) : undefined,
    finalTextSha: await shortHash(finalText),
    metadata: {
      queryText: scrubPII(userText),
      finalText: scrubPII(finalText),
      path:      'deterministic_write',
      // The booking decision — visible in the trace so a wrong date/time is auditable.
      booking:   { tool: toolName, ...args, source: 'client-stated' },
    },
  })

  return {
    text:   finalText,
    tokens: 0,
    toolCallsTrace: [{ step: 1, tool: toolName, args, result: parsed, duration_ms: Date.now() - stepStart, success }],
  }
}
