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
import type { INotificationService } from '@/lib/notifications/notification-service'
import type { AppointmentEvent, AppointmentEventType, BookingEventData } from './events'
import { StrategyFactory } from './strategy'
import { emitEvent } from './event-dispatcher'
import { buildConfirmationSummary } from './decision-engine'
import { logger } from '@/lib/logger'

// ── Tool Executor Interface ──────────────────────────────────────────────────
// Phase 1: Mock implementation. Phase 2: replaced with ToolAdapterRegistry.

export interface ToolExecuteParams {
  toolName:     string
  args:         Record<string, unknown>
  businessId:   string
  userId:       string
  timezone:     string
  /** Business working hours per day — passed to availability tools */
  workingHours?: Record<string, { open: string; close: string }>
}

export interface IToolExecutor {
  /**
   * Execute a named tool with the given arguments.
   *
   * Write-tools (confirm/cancel/reschedule) MUST populate `data` on success.
   * This structured payload replaces string parsing for notification dispatch.
   * Read-only tools (get_appointments, get_services, etc.) leave `data` undefined.
   */
  execute(params: ToolExecuteParams): Promise<{
    success: boolean
    result: string
    error?: string
    /** Structured booking data — present only for write-tool successes. */
    data?: BookingEventData
  }>
}

/**
 * Mock tool executor for tests and Phase 1.
 * Returns deterministic simulated results with structured `data` for write-tools,
 * matching the same contract that RealToolExecutor provides.
 */
export class MockToolExecutor implements IToolExecutor {
  async execute(params: ToolExecuteParams): Promise<{
    success: boolean
    result: string
    error?: string
    data?: BookingEventData
  }> {
    switch (params.toolName) {
      case 'confirm_booking': {
        const service = (params.args.serviceName as string) ?? 'Servicio'
        const date    = (params.args.date as string) ?? ''
        const time    = (params.args.time as string) ?? ''
        const client  = (params.args.clientName as string) ?? 'Cliente'
        return {
          success: true,
          result: `Listo. Agendé a ${client} para ${service} el ${date} a las ${time}.`,
          data: {
            appointmentId: 'mock-appt-id',
            clientName:    client,
            serviceName:   service,
            date,
            time,
            action:        'created',
          },
        }
      }
      case 'cancel_booking': {
        return {
          success: true,
          result: 'Listo. La cita ha sido cancelada.',
          data: {
            appointmentId: (params.args.appointment_id as string) ?? 'mock-appt-id',
            clientName:    'Cliente',
            serviceName:   'Servicio',
            date:          '',
            time:          '',
            action:        'cancelled',
          },
        }
      }
      case 'reschedule_booking': {
        const newDate = (params.args.new_date as string) ?? ''
        const newTime = (params.args.new_time as string) ?? ''
        return {
          success: true,
          result: `Listo. La cita fue reagendada para ${newDate} a las ${newTime}.`,
          data: {
            appointmentId: (params.args.appointment_id as string) ?? 'mock-appt-id',
            clientName:    'Cliente',
            serviceName:   'Servicio',
            date:          newDate,
            time:          newTime,
            action:        'rescheduled',
          },
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
  /** Real token count from the LLM provider (0 when unavailable). */
  tokens?: number
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

// ── Tool-to-event mapping ─────────────────────────────────────────────────────

const TOOL_TO_EVENT: Record<string, AppointmentEventType> = {
  confirm_booking:    'appointment.created',
  cancel_booking:     'appointment.cancelled',
  reschedule_booking: 'appointment.rescheduled',
}

/**
 * Builds an AppointmentEvent directly from structured BookingEventData.
 *
 * No regex, no string parsing. All fields come from the write-tool contract.
 * Called only when `result.data` is guaranteed to be present (write-tool success).
 */
function buildEventFromData(
  toolName: string,
  data: BookingEventData,
  input: AiInput,
): AppointmentEvent {
  const eventType = TOOL_TO_EVENT[toolName] ?? 'appointment.created'
  return {
    eventId:     crypto.randomUUID(),
    type:        eventType,
    businessId:  input.businessId,
    clientName:  data.clientName,
    serviceName: data.serviceName,
    date:        data.date,
    time:        data.time,
    userId:      input.userId,
    channel:     input.channel,
  }
}

// ── Output sanitization ─────────────────────────────────────────────────────
// Applied to every LLM-generated text before it reaches the user.
// Prevents internal syntax (function calls, markers, JSON) from leaking
// into the WhatsApp / web channel.

/**
 * Strips internal syntax that must never reach the user:
 *   - <function=name>...</function> blocks (attribute-style, e.g. Groq fallback format)
 *   - <function>...</function> blocks (tag-style, legacy format)
 *   - [CONFIRM_*] or similar internal bracket markers
 *   - Raw JSON objects exposing internal field names
 */
function sanitizeOutput(text: string): string {
  if (!text) return text

  return text
    // Remove <function=name>...</function> blocks (attribute-style — the primary leak vector)
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '')
    // Remove <function>...</function> blocks (tag-style, multi-line)
    .replace(/<function>[\s\S]*?<\/function>/gi, '')
    // Remove [CONFIRM_*] markers and bracket-style internal markers
    .replace(/\[CONFIRM_[^\]]+\]/gi, '')
    // Remove raw JSON objects that expose internal field names
    .replace(/\{[\s\S]*?"(?:service_id|client_id|appointment_id|date|time)":[\s\S]*?\}/gi, '')
    .trim()
}

/**
 * Hard guard: returns true if the text STILL contains internal syntax
 * after sanitization. Triggers a safe fallback response.
 * Covers both <function> (tag-style) and <function=name> (attribute-style).
 */
function containsInternalSyntax(text: string): boolean {
  return /<function[=\s>]|CONFIRM_|"service_id"|"client_id"|"appointment_id"/i.test(text)
}

/** Safe fallback shown when sanitization cannot fully clean the LLM output. */
const INTERNAL_SYNTAX_FALLBACK =
  'Estoy verificando la información para confirmarte correctamente. ¿Te parece bien ese horario?'

/**
 * Builds a deterministic owner-facing success line from structured write-tool data.
 * Used when the LLM finishes the turn without emitting text but a write tool
 * already succeeded in a previous iteration — avoids the generic "No pude procesar" fallback.
 */
function renderOwnerSuccessMessage(data: BookingEventData): string {
  const client  = data.clientName  || 'el cliente'
  const service = data.serviceName ? ` para ${data.serviceName}` : ''
  switch (data.action) {
    case 'created':
      return `Listo. Agendé a ${client}${service} el ${data.date} a las ${data.time}.`
    case 'cancelled':
      return `Listo. Cancelé la cita de ${client}${data.serviceName ? ` (${data.serviceName})` : ''}.`
    case 'rescheduled':
      return `Listo. Reagendé la cita de ${client} para el ${data.date} a las ${data.time}.`
  }
}

export class ExecutionEngine implements IExecutionEngine {
  /**
   * Set de eventIds emitidos en este request.
   * Previene emitir el mismo evento dos veces si un tool se llama
   * más de una vez en el mismo loop de razonamiento.
   * Se crea nuevo por instancia de ExecutionEngine (una por request).
   */
  private readonly processedEvents = new Set<string>()

  constructor(
    private toolExecutor: IToolExecutor = new MockToolExecutor(),
    private llmProvider: IMockLlmProvider = new DefaultMockLlmProvider(),
    /**
     * Notification service (opcional).
     * Si no se inyecta (tests, MockToolExecutor), las notificaciones se omiten.
     * Nunca afecta el resultado de la ejecución —
     * el booking se completa independientemente.
     */
    private notificationService?: INotificationService,
    /** Max ReAct loop iterations. Comes from the agent config (agents/dashboard/config.ts). */
    private maxReactIterations: number = 3,
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
      toolName:     decision.intent,
      args:         decision.args,
      businessId:   input.businessId,
      userId:       input.userId,
      timezone:     input.timezone,
      workingHours: input.context.workingHours as Record<string, { open: string; close: string }> | undefined,
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

      // Persist lastAction for owner session memory ("cancela lo último" fast-path)
      if (result.data && TOOL_TO_EVENT[decision.intent]) {
        newState.lastAction = {
          type:          result.data.action,
          appointmentId: result.data.appointmentId,
          clientName:    result.data.clientName,
          serviceName:   result.data.serviceName,
          date:          result.data.date,
          time:          result.data.time,
        }
      }

      // ── Event dispatch (fire-and-forget) ──────────────────────────────────
      // Solo emitir si hay servicio de notificaciones, el tool es de escritura,
      // y el tool retornó `data` estructurada (contrato obligatorio).
      if (this.notificationService && TOOL_TO_EVENT[decision.intent] && result.data) {
        const event = buildEventFromData(decision.intent, result.data, input)
        if (!this.processedEvents.has(event.eventId)) {
          this.processedEvents.add(event.eventId)
          emitEvent(event, this.notificationService)
          logger.info('EXECUTION-ENGINE', 'Event emitted (immediate path)', {
            eventId:   event.eventId,
            eventType: event.type,
          })
        }
      } else if (TOOL_TO_EVENT[decision.intent] && !result.data) {
        logger.warn('EXECUTION-ENGINE', 'Write tool succeeded but returned no structured data — notification skipped', {
          tool: decision.intent,
        })
      }
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
      toolName:     decision.toolName,
      args:         decision.args,
      businessId:   input.businessId,
      userId:       input.userId,
      timezone:     input.timezone,
      workingHours: input.context.workingHours as Record<string, { open: string; close: string }> | undefined,
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
    const MAX_STEPS = this.maxReactIterations
    let step = 0
    let totalTokens = 0
    const traces: ToolTrace[] = []
    const messages: LlmMessage[] = [...decision.messages]
    let responseText = ''
    let actionPerformed = false
    let lastLlmResponse: MockLlmResponse | null = null
    // Post-tool validation flag: if a write tool fails, exit the loop immediately.
    // Do NOT give the LLM another iteration — it may generate an optimistic response.
    let writeToolFailed = false
    const WRITE_TOOLS = new Set(['confirm_booking', 'cancel_booking', 'reschedule_booking'])
    /** Tracks the last successful write-tool payload for session memory ("cancela/reagenda lo último"). */
    let lastSuccessfulWriteData: BookingEventData | null = null
    /** Tracks consecutive failures per read-tool — bails out after 2 failures of the same tool. */
    const toolFailCounts = new Map<string, number>()

    while (step < MAX_STEPS) {
      step++

      logger.info('EXECUTION-ENGINE', `ReAct step ${step}/${MAX_STEPS} — calling LLM`, {
        businessId:  input.businessId,
        flow:        state.flow,
        messagesLen: messages.length,
      })

      lastLlmResponse = await this.llmProvider.chat(messages, decision.toolDefs)
      totalTokens += lastLlmResponse.tokens ?? 0

      logger.info('EXECUTION-ENGINE', `ReAct step ${step}/${MAX_STEPS} — LLM responded`, {
        hasContent:    Boolean(lastLlmResponse.content),
        toolCallCount: lastLlmResponse.tool_calls?.length ?? 0,
        tokensDelta:   lastLlmResponse.tokens ?? 0,
      })

      // ── Embedded function recovery ──────────────────────────────────────────
      // ROOT CAUSE: some LLM configurations serialize tool calls as raw text
      //   <function=confirm_booking>{"date":"2026-04-24","time":"08:00"}</function>
      // instead of structured tool_calls. This bypasses normal tool execution
      // and, without this guard, reaches the user verbatim.
      //
      // RECOVERY: detect the pattern, parse args, and synthesize a proper
      // tool_call so the standard execution path handles it transparently.
      // If args are not parseable, force a safe fallback and exit the loop.
      if (lastLlmResponse.content && !lastLlmResponse.tool_calls?.length) {
        const match1 = lastLlmResponse.content.match(/<function=([a-z_]+)>([\s\S]*?)<\/function>/i)
        const match2 = lastLlmResponse.content.match(/<function>\s*([a-z_]+)\s*<\/function>\s*(\{[\s\S]*\})/i)
        let fnName = ''
        let argsRaw = ''
        
        if (match1) { fnName = match1[1] ?? ''; argsRaw = match1[2] ?? '' }
        else if (match2) { fnName = match2[1] ?? ''; argsRaw = match2[2] ?? '' }

        if (fnName) {
          logger.warn('EXECUTION-ENGINE', 'LLM emitted embedded <function=> syntax — attempting recovery', {
            reason:  'internal_syntax_leak',
            tool:    fnName,
            snippet: lastLlmResponse.content.slice(0, 120),
          })
          let argsValid = false
          try { JSON.parse(argsRaw); argsValid = true } catch { /* non-parseable — cannot recover */ }

          if (argsValid && fnName) {
            // Inject as synthetic tool_call so the existing execution path handles it
            lastLlmResponse = {
              ...lastLlmResponse,
              content:    null,
              tool_calls: [{
                id:       `call_${Date.now()}`,
                type:     'function' as const,
                function: { name: fnName, arguments: argsRaw },
              }],
            }
          } else {
            // Cannot recover: block output and exit with safe message
            logger.warn('EXECUTION-ENGINE', 'Embedded function args unparseable — using safe fallback', {
              reason: 'internal_syntax_leak',
              argsRaw,
            })
            responseText = INTERNAL_SYNTAX_FALLBACK
            break
          }
        }
      }

      if (!lastLlmResponse.content && !lastLlmResponse.tool_calls?.length) {
        // Anti-fallback: a write tool already succeeded in a prior iteration.
        // Rendering the template is correct; falling to "No pude procesar" would lie to the user.
        if (actionPerformed && lastSuccessfulWriteData) {
          responseText = renderOwnerSuccessMessage(lastSuccessfulWriteData)
          break
        }
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

      // No tool calls → LLM produced a text response.
      // Hard guard: if the LLM claims to have booked/cancelled/rescheduled but NO write
      // tool was actually executed in this turn, block the false confirmation.
      // This prevents the LLM from hallucinating "listo, agendé la cita" without calling confirm_booking.
      if (!lastLlmResponse.tool_calls?.length) {
        const candidateText = lastLlmResponse.content ?? ''
        const WRITE_ACTION_PATTERNS = [
          /agend[eé]\s/i, /he\s+agendado/i, /cita\s+ha\s+sido\s+agendada/i,
          /cancel[eé]\s/i, /he\s+cancelado/i, /cita\s+ha\s+sido\s+cancelada/i,
          /reagend[eé]\s/i, /he\s+reagendado/i, /cita\s+ha\s+sido\s+reagendada/i,
        ]
        const noWriteToolCalled = !traces.some(
          (t) => t.tool === 'confirm_booking' || t.tool === 'cancel_booking' || t.tool === 'reschedule_booking'
        )
        const claimsWriteAction = WRITE_ACTION_PATTERNS.some((p) => p.test(candidateText))

        // TASK 1 — Hard guard: READ tool enforcement.
        // If the LLM claims to know available slots / appointment data WITHOUT calling
        // the verification tools, block the response to prevent hallucinated availability.
        const AVAILABILITY_CLAIM_PATTERNS = [
          /tienes?\s+(disponible|libre|hueco)/i,
          /hay\s+(disponibilidad|espacio|lugar|hueco)/i,
          /est[aá]\s+(disponible|libre|ocupado)/i,
          /no\s+hay\s+(disponibilidad|espacio|lugar|hueco|citas)/i,
          /s[íi]\s+(hay|tiene|tienes)\s+disponibilidad/i,
          /puedo\s+ofrecerte\s+el\s+horario/i,
          /hay\s+(citas?\s+(para|el|del)|agenda)/i,
        ]
        const noReadToolCalled = !traces.some(
          (t) => t.tool === 'get_available_slots' || t.tool === 'get_appointments_by_date'
        )
        const claimsAvailability = AVAILABILITY_CLAIM_PATTERNS.some((p) => p.test(candidateText))

        if (noWriteToolCalled && claimsWriteAction) {
          // LLM is claiming to have performed an action it never executed — block it.
          responseText = 'Necesito verificar la información antes de confirmar esta acción.'
        } else if (noReadToolCalled && claimsAvailability) {
          // TASK 1: LLM claims availability without verifying — block it.
          responseText = 'Necesito verificar la disponibilidad antes de confirmarte horarios.'
        } else {
          responseText = candidateText
        }
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

        // FIX #1 (Task 3) — Confirmation interception.
        // If the LLM wants to call a write tool but the user has NOT yet confirmed
        // (state.flow !== 'awaiting_confirmation'), intercept and present a structured
        // confirmation summary. The tool is NOT executed yet.
        //
        // Respects the strategy contract:
        //   owner / platform_admin → requiresConfirmation() = false → execute directly
        //   employee / external    → requiresConfirmation() = true  → intercept
        if (
          WRITE_TOOLS.has(toolCall.function.name) &&
          state.flow !== 'awaiting_confirmation' &&
          strategy.requiresConfirmation(state)
        ) {
          const summary = buildConfirmationSummary(
            toolCall.function.name,
            args as Record<string, unknown>,
            input.context.services,
          )
          // Build the new state: transition to awaiting_confirmation
          // and store the tool args as draft so execute_immediately can use them.
          const nextState: ConversationState = {
            ...state,
            flow:        'awaiting_confirmation',
            lastIntent:  toolCall.function.name,
            draft:       args as Record<string, string | undefined>,
            lastToolCalls: null,
            updatedAt:   new Date().toISOString(),
          }

          logger.info('EXECUTION-ENGINE', 'Write tool intercepted — awaiting confirmation', {
            tool:    toolCall.function.name,
            summary: summary.slice(0, 120),
          })

          // Return early — the tool is NOT executed.
          // Clean history: exclude the unresolved tool_calls assistant turn
          // so the confirmation prompt is the last thing the user sees.
          const cleanHistory = messages.slice(decision.messages.length, -1) as LlmMessage[]
          return {
            text:            summary,
            actionPerformed: false,
            toolTrace:       traces,
            tokens:          totalTokens,
            nextState,
            llmMessages:     cleanHistory,
          }
        }

        // FIX (Task 4) — State Priority: lock confirmed UUID fields from draft.
        // Prevents the LLM from silently substituting service_id, client_id, or
        // appointment_id with a different value after the user already confirmed them.
        if (state.draft && WRITE_TOOLS.has(toolCall.function.name)) {
          const UUID_FIELDS = ['service_id', 'client_id', 'appointment_id'] as const
          for (const field of UUID_FIELDS) {
            const draftValue = (state.draft as Record<string, string | undefined>)[field]
            if (typeof draftValue === 'string' && draftValue.length > 0) {
              args[field] = draftValue
            }
          }
        }

        logger.info('EXECUTION-ENGINE', `ReAct step ${step} — executing tool`, {
          tool:     toolCall.function.name,
          argsKeys: Object.keys(args),
        })

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
          toolName:     toolCall.function.name,
          args,
          businessId:   input.businessId,
          userId:       input.userId,
          timezone:     input.timezone,
          workingHours: input.context.workingHours as Record<string, { open: string; close: string }> | undefined,
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

          // Session memory: capture last write-action for owner fast-path commands
          if (result.data && WRITE_TOOLS.has(toolCall.function.name)) {
            lastSuccessfulWriteData = result.data
          }

          // ── Event dispatch per write-tool success (fire-and-forget) ──────────
          // processedEvents evita duplicados si el mismo tool se llama dos veces.
          // Requiere `result.data` — contrato obligatorio de write-tools.
          if (this.notificationService && TOOL_TO_EVENT[toolCall.function.name]) {
            if (result.data) {
              const event = buildEventFromData(toolCall.function.name, result.data, input)
              if (!this.processedEvents.has(event.eventId)) {
                this.processedEvents.add(event.eventId)
                emitEvent(event, this.notificationService)
                logger.info('EXECUTION-ENGINE', 'Event emitted (reasoning loop)', {
                  eventId:   event.eventId,
                  eventType: event.type,
                  tool:      toolCall.function.name,
                })
              }
            } else {
              logger.warn('EXECUTION-ENGINE', 'Write tool succeeded but returned no structured data — notification skipped', {
                tool: toolCall.function.name,
              })
            }
          }
        } else if (WRITE_TOOLS.has(toolCall.function.name)) {
          // CRÍTICO: write tool failed — bail out immediately.
          // If we continue to another LLM iteration, the model may hallucinate success.
          // Provide a safe, controlled error message instead.
          const errorDetail = typeof result.result === 'string' && result.result.length > 0
            ? ` (${result.result})`
            : ''
          responseText = `No pude completar la acción${errorDetail}. Por favor, verifica los datos e inténtalo nuevamente.`
          writeToolFailed = true
        } else if (!result.success) {
          // Read tool failed — track and bail out after 2 consecutive failures of the same tool
          // to prevent the LLM from retrying a broken tool indefinitely.
          const failCount = (toolFailCounts.get(toolCall.function.name) ?? 0) + 1
          toolFailCounts.set(toolCall.function.name, failCount)
          logger.warn('EXECUTION-ENGINE', `Read tool failed (${failCount}x)`, {
            tool:   toolCall.function.name,
            result: typeof result.result === 'string' ? result.result.slice(0, 120) : String(result.result),
          })
          if (failCount >= 2) {
            responseText = 'No pude obtener la información necesaria. Por favor, inténtalo de nuevo.'
            writeToolFailed = true
          }
        }
      }

      // Bail out of the outer while loop if a write tool failed
      if (writeToolFailed) break
    } // end while

    // If loop exhausted without a response
    if (!responseText) {
      // Same anti-fallback rule: prefer the success template when we already wrote data.
      if (actionPerformed && lastSuccessfulWriteData) {
        responseText = renderOwnerSuccessMessage(lastSuccessfulWriteData)
      } else {
        responseText = 'Lo siento, estoy teniendo dificultades para procesar esta acción. ¿Podemos intentarlo de nuevo?'
      }
      logger.warn('EXECUTION-ENGINE', 'ReAct loop exhausted without response', {
        businessId: input.businessId,
        steps:      step,
        maxSteps:   MAX_STEPS,
        flow:       state.flow,
      })
    }

    // Sanitize: strip false-certainty phrases that appear when no tool was called.
    // "El negocio está cerrado" and "no hay disponibilidad" are only valid if
    // get_available_slots was actually invoked. Without it, they are hallucinations.
    if (traces.length === 0) {
      responseText = responseText
        .replace(/el\s+negocio\s+est[aá]\s+cerrado[^.!?]*/gi, '')
        .replace(/no\s+hay\s+disponibilidad[^.!?]*/gi, '')
        .trim()
      if (!responseText) {
        responseText = 'Necesito verificar esa información. ¿Podías decirme qué necesitas exactamente?'
      }
    }

    // ── Output enforcement: strip internal syntax before reaching the user ────
    // Layer 1 — sanitize: remove known patterns unconditionally.
    responseText = sanitizeOutput(responseText)
    // Layer 2 — hard guard: if any internal syntax survived, use a safe fallback.
    if (containsInternalSyntax(responseText)) {
      logger.warn('EXECUTION-ENGINE', 'Internal syntax detected after sanitization — using fallback', {
        snippet: responseText.slice(0, 120),
      })
      responseText = INTERNAL_SYNTAX_FALLBACK
    }

    // Use real tokens if available, fall back to rough estimate when provider returns 0
    const estimatedTokens = totalTokens > 0
      ? totalTokens
      : step * 200 + responseText.split(/\s+/).length

    // Collect all messages produced in this turn (excluding the system prompt at index 0)
    // so the orchestrator can include tool call context in the returned history.
    const turnMessages = messages.slice(decision.messages.length) as LlmMessage[]

    // Reset flow when the turn is clearly over:
    //   - action succeeded (booking completed)       → next message should be a fresh intent
    //   - write tool failed (bail-out path)          → don't leave the user trapped in collecting_booking
    // Keeps the draft/flow intact for genuine mid-collection turns where the LLM is
    // legitimately asking for one more field.
    const shouldResetFlow = actionPerformed || writeToolFailed

    return {
      text: responseText,
      actionPerformed,
      toolTrace: traces,
      tokens: estimatedTokens,
      nextState: {
        ...state,
        flow:          shouldResetFlow ? 'idle' : state.flow,
        draft:         shouldResetFlow ? null   : state.draft,
        missingFields: shouldResetFlow ? []     : state.missingFields,
        lastIntent:    shouldResetFlow ? null   : state.lastIntent,
        lastToolCalls: lastLlmResponse?.tool_calls ?? null,
        // Propagate lastAction: use the new write-tool result if one succeeded this turn,
        // otherwise carry forward the existing session lastAction (or null if none).
        lastAction: lastSuccessfulWriteData
          ? {
              type:          lastSuccessfulWriteData.action,
              appointmentId: lastSuccessfulWriteData.appointmentId,
              clientName:    lastSuccessfulWriteData.clientName,
              serviceName:   lastSuccessfulWriteData.serviceName,
              date:          lastSuccessfulWriteData.date,
              time:          lastSuccessfulWriteData.time,
            }
          : (state.lastAction ?? null),
      },
      llmMessages: turnMessages,
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
