/**
 * executor.ts — Tool Executor for the ReAct loop.
 *
 * Exposes: executeCommands()
 * Does not expose: LLM calls, session logic, STT/TTS.
 * Guarantees: executes AiCommand[] and returns tool results — never plans.
 *
 * Single Responsibility: decides HOW to run tools. The planner decides WHAT.
 *
 * Security:
 *  - WRITE tools are rate-limited per userId (prevents abuse).
 *  - Each tool has a 10s hard timeout (prevents DB/API hangs).
 *  - Null/undefined args stripped before execution (schema safety).
 */

import type { AiCommand }    from './planner'
import type { ExecutorResult, StepTrace } from './types'
import { toolRegistry }      from '@/lib/ai/tool-registry'
import { writeToolRateLimiter, WRITE_TOOLS } from '@/lib/api/rate-limit'
import { logger }            from '@/lib/logger'

const TOOL_TIMEOUT_MS = 10_000

/**
 * Tools restricted to owners (and platform_admin).
 * Employees get a polite refusal — no data leaks, no exceptions.
 *
 * These are enforced at EXECUTION time, not just in the LLM prompt,
 * so prompt injection or jailbreaks cannot bypass the restriction.
 */
const OWNER_ONLY_TOOLS = new Set([
  'get_revenue_stats',
  'get_monthly_forecast',
  'get_client_debt',
  'register_payment',
  'get_today_summary',  // Returns daily revenue — owner-only financial data
])

/**
 * Executes a set of AI commands (tool calls) planned by the planner.
 *
 * Handles per-tool rate limiting, role enforcement, timeouts, and error
 * isolation so that a single failing tool does not abort the entire batch.
 */
export async function executeCommands(
  commands:   AiCommand[],
  businessId: string,
  userId:     string,
  timezone?:  string,
  userRole?:  string,
): Promise<ExecutorResult> {
  const traces: StepTrace[] = []
  const toolMessages: { tool_call_id: string; name: string; content: string }[] = []

  for (const command of commands) {
    const stepStart = Date.now()
    const trace: StepTrace = {
      toolName:    command.toolName,
      duration_ms: 0,
      success:     false,
      rateLimited: false,
      timedOut:    false,
    }

    // SECURITY: Enforce owner-only tools at execution time.
    // The LLM prompt also enforces this, but prompt injection cannot bypass
    // a hard check here. Employees get a clear, non-technical refusal.
    const isEmployee = userRole === 'employee'
    if (isEmployee && OWNER_ONLY_TOOLS.has(command.toolName)) {
      logger.warn('AI-EXECUTOR', `Role violation blocked: ${command.toolName}`, { userId, userRole })
      toolMessages.push({
        tool_call_id: command.toolCallId,
        name:         command.toolName,
        content:      'Esta información es exclusiva del propietario del negocio.',
      })
      traces.push({ toolName: command.toolName, duration_ms: 0, success: false, rateLimited: false, timedOut: false })
      continue
    }

    // SECURITY: Rate limit WRITE tools to prevent abuse
    if (WRITE_TOOLS.has(command.toolName)) {
      const { limited } = writeToolRateLimiter.isRateLimited(userId)
      if (limited) {
        logger.warn('AI-EXECUTOR', `WRITE rate limit hit for tool ${command.toolName}`, { userId })
        trace.rateLimited = true
        trace.duration_ms = Date.now() - stepStart
        traces.push(trace)

        toolMessages.push({
          tool_call_id: command.toolCallId,
          name:         command.toolName,
          content:      'Has realizado demasiadas operaciones en poco tiempo. Por seguridad, espera una hora antes de continuar.',
        })
        continue
      }
    }

    // Execute with 10s hard timeout
    let content: string
    try {
      const toolPromise = toolRegistry.execute(
        command.toolName,
        command.args,
        businessId,
        timezone,
      )
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout (10s)')), TOOL_TIMEOUT_MS)
      )

      content = await Promise.race([toolPromise, timeoutPromise])
      trace.success = true
      logger.info('AI-EXECUTOR', `Success: ${command.toolName}`, {
        userId,
        duration_ms: Date.now() - stepStart,
      })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      trace.timedOut = errMsg.includes('timeout')
      logger.error('AI-EXECUTOR', `Failed: ${command.toolName}`, {
        error:       errMsg,
        userId,
        duration_ms: Date.now() - stepStart,
      })
      content = 'Error técnico al ejecutar la acción. Intenta de nuevo en un momento.'
    }

    trace.duration_ms = Date.now() - stepStart
    traces.push(trace)

    toolMessages.push({
      tool_call_id: command.toolCallId,
      name:         command.toolName,
      content,
    })
  }

  return {
    toolMessages,
    actionPerformed: true,
    traces,
  }
}
