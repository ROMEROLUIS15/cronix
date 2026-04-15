/**
 * types.ts — Core type definitions for the AI Orchestrator.
 *
 * These types define the contract between all orchestrator components:
 *   AiInput → Orchestrator → AiOutput
 *
 * Reuses LlmMessage and ToolCall from providers/types.ts for compatibility
 * with existing LLM providers.
 */

import type { LlmMessage, ToolCall } from '@/lib/ai/providers/types'

// ── User Role ─────────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'employee' | 'platform_admin' | 'external'

// ── Channel ───────────────────────────────────────────────────────────────────

export type AiChannel = 'whatsapp' | 'web'

// ── Business Context ──────────────────────────────────────────────────────────
// Read-only context injected by the channel adapter. Contains data the AI
// needs to reason about the business (services, active appointments, etc.)

export interface BusinessContext {
  businessId: string
  businessName: string
  timezone: string
  workingHours?: Record<string, { open: string; close: string }>
  aiRules?: string
  services?: Array<{ id: string; name: string; duration_min: number; price: number }>
  activeAppointments?: Array<{
    id: string
    serviceName: string
    clientName: string
    startAt: string  // ISO
    endAt: string    // ISO
    status: string
  }>
  bookedSlots?: Array<{ startAt: string; endAt: string }>
  [key: string]: unknown
}

// ── AiInput ───────────────────────────────────────────────────────────────────
// The single input shape that every channel adapter must construct.
// Contains everything the orchestrator needs to process a request.

export interface AiInput {
  /** User text (already transcribed if it came from audio) */
  text: string
  /** Unique user identifier (sender phone for WA, user.id for Web) */
  userId: string
  /** Business this interaction belongs to */
  businessId: string
  /** Role determines behavior: owner→direct, external→confirmation */
  userRole: UserRole
  /** IANA timezone for date/time calculations */
  timezone: string
  /** Which channel originated this request */
  channel: AiChannel
  /** Conversation history (max 8 messages) */
  history: LlmMessage[]
  /** Business context: services, appointments, slots */
  context: BusinessContext
  /** Optional: request ID for end-to-end tracing */
  requestId?: string
  /** Optional: user display name */
  userName?: string
}

// ── ConversationState ─────────────────────────────────────────────────────────
// Explicit state machine for multi-turn conversations.
// Stored in Redis (or fallback in-memory). Separate from message history.

export type ConversationFlow =
  | 'idle'
  | 'collecting_booking'
  | 'awaiting_confirmation'
  | 'collecting_cancellation'
  | 'collecting_reschedule'
  | 'answering_query'
  | 'executing'

export interface DraftPayload {
  // Booking fields
  clientId?: string
  clientName?: string
  clientPhone?: string
  serviceId?: string
  serviceName?: string
  date?: string        // YYYY-MM-DD
  time?: string        // HH:mm
  staffId?: string

  // Cancellation fields
  appointmentId?: string
  appointmentDate?: string

  // Reschedule fields
  sourceAppointmentId?: string
  newDate?: string
  newTime?: string

  // Allow arbitrary fields for future extensibility
  [key: string]: string | undefined
}

export interface ConversationState {
  sessionId: string
  userId: string
  businessId: string
  channel: AiChannel

  // Flow state
  flow: ConversationFlow
  draft: DraftPayload | null
  missingFields: string[]

  // Tracking
  lastIntent: string | null
  lastToolCalls: ToolCall[] | null
  turnCount: number
  maxTurns: number

  // Timestamps
  createdAt: string  // ISO
  updatedAt: string  // ISO
}

// ── Decision ──────────────────────────────────────────────────────────────────
// What the DecisionEngine returns after analyzing input + state.
// Each variant drives a different execution path.

export type Decision =
  | {
      type: 'execute_immediately'
      intent: string
      args: Record<string, unknown>
    }
  | {
      type: 'continue_collection'
      intent: string
      missingFields: string[]
      prompt: string
      extractedData: Record<string, unknown>
      /** Complete draft including inferred fields (not just extracted entities) */
      updatedDraft: Record<string, unknown>
    }
  | {
      type: 'await_confirmation'
      intent: string
      summary: string
    }
  | {
      type: 'answer_query'
      toolName: string
      args: Record<string, unknown>
    }
  | {
      type: 'reason_with_llm'
      messages: LlmMessage[]
      toolDefs: Array<{
        type: 'function'
        function: {
          name: string
          description: string
          parameters: {
            type: 'object'
            properties: Record<string, {
              type: string
              description?: string
              enum?: string[]
            }>
            required: string[]
            additionalProperties?: false
          }
        }
      }>
    }
  | {
      type: 'reject'
      reason: string
    }

// ── ExecutionResult ───────────────────────────────────────────────────────────
// What the ExecutionEngine returns after executing a decision.

export interface ToolTrace {
  step: number
  tool: string
  args: Record<string, unknown>
  result: unknown
  duration_ms: number
  success: boolean
}

export interface ExecutionResult {
  text: string
  actionPerformed: boolean
  toolTrace: ToolTrace[]
  tokens: number
  nextState: ConversationState
  /**
   * Full LLM message chain from this turn (system excluded).
   * Includes: user → assistant+tool_calls → tool results → assistant text.
   * When populated, the orchestrator uses these instead of the plain
   * user+assistant pair so the next turn's LLM has complete tool context.
   */
  llmMessages?: LlmMessage[]
}

// ── AiOutput ──────────────────────────────────────────────────────────────────
// The single output shape that every channel adapter consumes.

export interface AiOutput {
  /** Text response for the end user */
  text: string
  /** Whether a business action was performed (create, cancel, reschedule) */
  actionPerformed: boolean
  /** Trace of tool calls for auditing */
  toolTrace: ToolTrace[]
  /** Estimated token usage for quota tracking */
  tokens: number
  /** Updated conversation state (for the channel adapter to persist) */
  state: ConversationState
  /** Optional: history to send back to LLM on next turn */
  history: LlmMessage[]
}
