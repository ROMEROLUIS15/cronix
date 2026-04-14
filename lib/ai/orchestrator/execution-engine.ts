/**
 * execution-engine.ts — Executes the decision produced by DecisionEngine.
 *
 * Responsibilities:
 *   - Execute immediate actions (direct tool calls)
 *   - Run the LLM reasoning loop (for complex decisions)
 *   - Handle tool execution results and feed back to LLM
 *   - Build the final text response
 *
 * Does NOT:
 *   - Make decisions about what to do
 *   - Manage conversation state
 *   - Validate input (that's the DecisionEngine's job)
 *
 * Phase 1 Note:
 *   Actual tool/tool-adapter/use-case integration is deferred to Phase 2.
 *   This engine uses a ToolExecutor interface that returns mock results
 *   until the real tool adapter layer is built.
 */

import type {
  Decision,
  ExecutionResult,
  ConversationState,
  AiInput,
  ToolTrace,
} from './types'
import type { LlmMessage } from '@/lib/ai/providers/types'
import type { IUserStrategy } from './strategy'
import { StrategyFactory } from './strategy'

// ── Tool Executor Interface ──────────────────────────────────────────────────
// Phase 1: Mock implementation. Phase 2: replaced with ToolAdapterRegistry.

export interface ToolExecuteParams {
  toolName: string
  args: Record<string, unknown>
  businessId: string
  userId: string
  timezone: string
}

export interface IToolExecutor {
  /**
   * Execute a named tool with the given arguments.
   * Returns a result string that may be a success message or error.
   */
  execute(params: ToolExecuteParams): Promise<{
    success: boolean
    result: string
    error?: string
  }>
}

/**
 * Mock tool executor for Phase 1.
 * Returns deterministic simulated results so the orchestrator is testable
 * without real DB or API dependencies.
 */
export class MockToolExecutor implements IToolExecutor {
  async execute(params: ToolExecuteParams): Promise<{
    success: boolean
    result: string
    error?: string
  }> {
    // Simulate tool behavior based on tool name
    switch (params.toolName) {
      case 'confirm_booking': {
        const service = (params.args.serviceName as string) ?? 'Servicio'
        const date = (params.args.date as string) ?? ''
        const time = (params.args.time as string) ?? ''
        const client = (params.args.clientName as string) ?? 'Cliente'
        return {
          success: true,
          result: `Listo. Agendé a ${client} para ${service} el ${date} a las ${time}.`,
        }
      }
      case 'cancel_booking': {
        return {
          success: true,
          result: 'Listo. La cita ha sido cancelada correctamente.',
        }
      }
      case 'reschedule_booking': {
        const newDate = (params.args.newDate as string) ?? ''
        const newTime = (params.args.newTime as string) ?? ''
        return {
          success: true,
          result: `Listo. La cita fue reagendada para ${newDate} a las ${newTime}.`,
        }
      }
      case 'get_appointments_by_date': {
        return {
          success: true,
          result: `No hay citas programadas para ${params.args.date ?? 'esa fecha'}.`,
        }
      }
      case 'get_services': {
        return {
          success: true,
          result: 'Servicios disponibles: Corte de Cabello (30 min, $25), Tinte (60 min, $40), Peinado (20 min, $15).',
        }
      }
      default:
        return {
          success: false,
          result: `Tool "${params.toolName}" no está implementado aún.`,
          error: `TOOL_NOT_FOUND: ${params.toolName}`,
        }
    }
  }
}

// ── Mock LLM Provider for Phase 1 ────────────────────────────────────────────

export interface MockLlmResponse {
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface IMockLlmProvider {
  /**
   * Simulates an LLM call for Phase 1 testing.
   * In Phase 2, replaced with real ILlmProvider.
   */
  chat(messages: LlmMessage[], toolDefs?: unknown[]): Promise<MockLlmResponse>
}

/**
 * Default mock LLM that always responds with text.
 * Override in tests to simulate tool-calling behavior.
 */
export class DefaultMockLlmProvider implements IMockLlmProvider {
  async chat(_messages: LlmMessage[], _toolDefs?: unknown[]): Promise<MockLlmResponse> {
    return {
      content: 'Entendido. ¿En qué más puedo ayudarte?',
    }
  }
}

// ── ExecutionEngine ──────────────────────────────────────────────────────────

export interface IExecutionEngine {
  /**
   * Execute a decision and return an ExecutionResult.
   *
   * The result includes:
   *   - text response for the user
   *   - whether an action was performed
   *   - tool trace for auditing
   *   - estimated token count
   *   - updated conversation state
   */
  execute(
    decision: Decision,
    state: ConversationState,
    input: AiInput
  ): Promise<ExecutionResult>
}

export class ExecutionEngine implements IExecutionEngine {
  constructor(
    private toolExecutor: IToolExecutor = new MockToolExecutor(),
    private llmProvider: IMockLlmProvider = new DefaultMockLlmProvider(),
  ) {}

  async execute(
    decision: Decision,
    state: ConversationState,
    input: AiInput,
  ): Promise<ExecutionResult> {
    const strategy = StrategyFactory.forRole(input.userRole)

    switch (decision.type) {
      // ── Direct execution (fast path or confirmed action) ──────────────────
      case 'execute_immediately':
        return this.executeImmediate(decision, state, input, strategy)

      // ── Continue collecting data ──────────────────────────────────────────
      case 'continue_collection':
        return this.executeCollection(decision, state)

      // ── Awaiting user confirmation ───────────────────────────────────────
      case 'await_confirmation':
        return this.executeConfirmation(decision, state)

      // ── Answer a data query ───────────────────────────────────────────────
      case 'answer_query':
        return this.executeQuery(decision, state, input, strategy)

      // ── LLM reasoning loop ────────────────────────────────────────────────
      case 'reason_with_llm':
        return this.executeReasoning(decision, state, input, strategy)

      // ── Rejected (turn limit or user rejection) ───────────────────────────
      case 'reject':
        return this.executeReject(decision, state)

      default: {
        const _exhaustive: never = decision
        return {
          text: 'Lo siento, no pude procesar esa solicitud.',
          actionPerformed: false,
          toolTrace: [],
          tokens: 0,
          nextState: { ...state },
        }
      }
    }
  }

  // ── Private: Execute immediate action ──────────────────────────────────────

  private async executeImmediate(
    decision: Extract<Decision, { type: 'execute_immediately' }>,
    state: ConversationState,
    input: AiInput,
    strategy: IUserStrategy,
  ): Promise<ExecutionResult> {
    const stepStart = Date.now()

    // Authorization check
    if (!strategy.canExecute(decision.intent)) {
      return {
        text: 'No tienes permisos para realizar esa acción.',
        actionPerformed: false,
        toolTrace: [],
        tokens: 0,
        nextState: { ...state },
      }
    }

    const result = await this.toolExecutor.execute({
      toolName: decision.intent,
      args: decision.args,
      businessId: input.businessId,
      userId: input.userId,
      timezone: input.timezone,
    })

    const trace: ToolTrace = {
      step: 1,
      tool: decision.intent,
      args: decision.args,
      result: result.result,
      duration_ms: Date.now() - stepStart,
      success: result.success,
    }

    const newState: ConversationState = { ...state }

    if (result.success) {
      // Action completed → reset state
      newState.flow = 'idle'
      newState.draft = null
      newState.missingFields = []
      newState.lastIntent = null
    }

    return {
      text: result.result,
      actionPerformed: result.success,
      toolTrace: [trace],
      tokens: 50, // Estimated for Phase 1
      nextState: newState,
    }
  }

  // ── Private: Continue data collection ──────────────────────────────────────

  private async executeCollection(
    decision: Extract<Decision, { type: 'continue_collection' }>,
    state: ConversationState,
  ): Promise<ExecutionResult> {
    const newState: ConversationState = { ...state }

    // Use the complete draft from the DecisionEngine (includes inferred fields)
    if (decision.updatedDraft && Object.keys(decision.updatedDraft).length > 0) {
      newState.draft = decision.updatedDraft as ConversationState['draft']
    } else if (Object.keys(decision.extractedData).length > 0) {
      // Fallback: merge only extracted entities (legacy path)
      if (!newState.draft) {
        newState.draft = {} as ConversationState['draft']
      }
      for (const [key, value] of Object.entries(decision.extractedData)) {
        if (value !== undefined && value !== null) {
          (newState.draft as Record<string, unknown>)[key] = value
        }
      }
    }

    // Set flow to collecting if it was idle
    if (newState.flow === 'idle') {
      newState.flow = 'collecting_booking'
    }

    newState.lastIntent = decision.intent
    newState.missingFields = decision.missingFields

    return {
      text: decision.prompt,
      actionPerformed: false,
      toolTrace: [],
      tokens: 10, // Minimal
      nextState: newState,
    }
  }

  // ── Private: Awaiting confirmation ─────────────────────────────────────────

  private async executeConfirmation(
    decision: Extract<Decision, { type: 'await_confirmation' }>,
    state: ConversationState,
  ): Promise<ExecutionResult> {
    const newState: ConversationState = {
      ...state,
      flow: 'awaiting_confirmation',
      lastIntent: decision.intent,
    }

    return {
      text: decision.summary,
      actionPerformed: false,
      toolTrace: [],
      tokens: 10,
      nextState: newState,
    }
  }

  // ── Private: Answer a data query ───────────────────────────────────────────

  private async executeQuery(
    decision: Extract<Decision, { type: 'answer_query' }>,
    state: ConversationState,
    input: AiInput,
    strategy: IUserStrategy,
  ): Promise<ExecutionResult> {
    const stepStart = Date.now()

    if (!strategy.canExecute(decision.toolName)) {
      return {
        text: 'No tienes permisos para consultar esa información.',
        actionPerformed: false,
        toolTrace: [],
        tokens: 0,
        nextState: { ...state },
      }
    }

    const result = await this.toolExecutor.execute({
      toolName: decision.toolName,
      args: decision.args,
      businessId: input.businessId,
      userId: input.userId,
      timezone: input.timezone,
    })

    const trace: ToolTrace = {
      step: 1,
      tool: decision.toolName,
      args: decision.args,
      result: result.result,
      duration_ms: Date.now() - stepStart,
      success: result.success,
    }

    return {
      text: result.result,
      actionPerformed: true,
      toolTrace: [trace],
      tokens: 30,
      nextState: { ...state },
    }
  }

  // ── Private: LLM reasoning loop ────────────────────────────────────────────

  private async executeReasoning(
    decision: Extract<Decision, { type: 'reason_with_llm' }>,
    state: ConversationState,
    input: AiInput,
    strategy: IUserStrategy,
  ): Promise<ExecutionResult> {
    const MAX_STEPS = 3
    let step = 0
    const traces: ToolTrace[] = []
    const messages: LlmMessage[] = [...decision.messages]
    let responseText = ''
    let actionPerformed = false
    let lastLlmResponse: MockLlmResponse | null = null

    while (step < MAX_STEPS) {
      step++

      lastLlmResponse = await this.llmProvider.chat(messages, decision.toolDefs)

      if (!lastLlmResponse.content && !lastLlmResponse.tool_calls?.length) {
        responseText = 'No pude procesar esa solicitud. Por favor, inténtalo de nuevo.'
        break
      }

      // Add assistant turn
      messages.push({
        role: 'assistant',
        content: lastLlmResponse.content,
        tool_calls: lastLlmResponse.tool_calls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })

      // No tool calls → LLM produced a text response
      if (!lastLlmResponse.tool_calls?.length) {
        responseText = lastLlmResponse.content ?? ''
        break
      }

      // Execute each tool call
      for (const toolCall of lastLlmResponse.tool_calls) {
        const stepStart = Date.now()

        let args: Record<string, unknown>
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
        } catch {
          args = {}
        }

        // Authorization check
        if (!strategy.canExecute(toolCall.function.name)) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: 'No tienes permisos para esa acción.',
          })
          traces.push({
            step,
            tool: toolCall.function.name,
            args,
            result: 'Unauthorized',
            duration_ms: Date.now() - stepStart,
            success: false,
          })
          continue
        }

        const result = await this.toolExecutor.execute({
          toolName: toolCall.function.name,
          args,
          businessId: input.businessId,
          userId: input.userId,
          timezone: input.timezone,
        })

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: result.result,
        })

        traces.push({
          step,
          tool: toolCall.function.name,
          args,
          result: result.result,
          duration_ms: Date.now() - stepStart,
          success: result.success,
        })

        if (result.success) {
          actionPerformed = true
        }
      }
    }

    // If loop exhausted without a response
    if (!responseText) {
      responseText = 'Intenté procesar tu solicitud pero no pude completarla. Por favor, inténtalo de nuevo.'
    }

    const estimatedTokens = step * 200 + responseText.split(/\s+/).length

    return {
      text: responseText,
      actionPerformed,
      toolTrace: traces,
      tokens: estimatedTokens,
      nextState: { ...state, lastToolCalls: lastLlmResponse?.tool_calls ?? null },
    }
  }

  // ── Private: Rejected ──────────────────────────────────────────────────────

  private async executeReject(
    decision: Extract<Decision, { type: 'reject' }>,
    state: ConversationState,
  ): Promise<ExecutionResult> {
    const newState: ConversationState = { ...state }

    // If the user rejected during confirmation, reset to idle
    if (state.flow === 'awaiting_confirmation') {
      newState.flow = 'idle'
      newState.draft = null
      newState.missingFields = []
      newState.lastIntent = null
    }

    return {
      text: decision.reason,
      actionPerformed: false,
      toolTrace: [],
      tokens: 5,
      nextState: newState,
    }
  }
}
