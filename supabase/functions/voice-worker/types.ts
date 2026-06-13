/**
 * Shared types for the voice-worker Edge Function.
 *
 * Mirrors the contracts the dashboard FAB expects, so the frontend code stays
 * the same shape it had with the old QStash/polling architecture (minus the
 * job_id indirection).
 */

// ── HTTP contract ──────────────────────────────────────────────────────────

export interface VoiceWorkerResponse {
  /** Final user-facing text (already speaks-like, ready for TTS). */
  text:            string
  /** data: URL with base64 mp3, or null when TTS failed. */
  audioUrl:        string | null
  /** True when a write tool succeeded (booking/cancel/reschedule). */
  actionPerformed: boolean
  /** STT result echoed back so the FAB can show the user what was heard. */
  transcription:   string
  /** Provider used for the LLM call, for logging only. */
  modelUsed:       string
}

// ── Domain types (used internally by the agent) ────────────────────────────

export type UserRole = 'owner' | 'admin' | 'employee' | 'external'

export interface BusinessContext {
  businessId:   string
  businessName: string
  timezone:     string
  aiRules?:     string
  workingHours?: Record<string, { open: string; close: string } | null>
  services: Array<{
    id:           string
    name:         string
    duration_min: number
    price:        number
  }>
  /** Today's appointments for prompt context (max 5 shown). */
  activeAppointments: Array<{
    startAt:     string
    clientName:  string
    serviceName: string
  }>
  /**
   * Most-recently-active clients of the business — the LLM uses this as the
   * authoritative roster of registered names. When the STT mishears a name
   * (e.g., "Bicet" for "Lisset") the model maps back to the right registered
   * client by consulting this list rather than echoing the STT verbatim.
   * Capped at 100, ordered last_visit_at DESC NULLS LAST, created_at DESC.
   */
  activeClients: Array<{
    id:    string
    name:  string
    phone: string | null
  }>
  /**
   * Assignable team members (active users who can take appointments). Drives
   * whether the voice agent offers/asks about staff assignment AT ALL: with
   * fewer than two members there is nobody to disambiguate, so the prompt
   * omits staff handling entirely and the LLM never invents an assignee.
   */
  activeStaff: Array<{
    id:   string
    name: string
  }>
}

export interface AgentInput {
  text:       string
  userId:     string
  userName:   string
  userRole:   UserRole
  businessId: string
  timezone:   string
  history:    Array<{ role: 'user' | 'assistant'; content: string }>
  context:    BusinessContext
  /**
   * Most recent appointment the agent created / rescheduled / cancelled
   * within the session TTL. Capabilities like reschedule and cancel use
   * this as the implicit subject when the user says "reagéndala" /
   * "cancélala" without naming a client.
   */
  lastRef?: {
    appointmentId: string
    clientName:    string
    serviceName:   string
    date:          string
    time:          string
  } | null
}

export interface AgentOutput {
  text:            string
  actionPerformed: boolean
  history:         Array<{ role: 'user' | 'assistant'; content: string }>
  modelUsed:       string
  /** Bell notifications captured during this turn (fired AFTER response). */
  pendingNotifications: AppointmentNotification[]
  /**
   * Set when this turn successfully wrote an appointment (created /
   * rescheduled / cancelled). index.ts persists it into the session so
   * follow-up anaphoric turns ("reagéndala", "cancélala") can resolve
   * without forcing the user to repeat the client name.
   */
  lastRefCandidate?: {
    appointmentId: string
    clientName:    string
    serviceName:   string
    date:          string
    time:          string
  } | null
}

// LlmMessage was removed — replaced by NeutralMessage in providers/ILLMProvider.ts.
// Provider-specific message shapes live inside each provider's translator.

// ── Tool execution contract ────────────────────────────────────────────────

export interface ToolResult {
  success: boolean
  /** Human-readable result for the LLM to consume. */
  result:  string
  /** Optional structured data — present for write tools (booking events). */
  data?:   BookingEventData
  /** Optional error code for logging. */
  error?:  string
  /**
   * When true, the agent's fast-path branch should NOT short-circuit on this
   * result and should instead fall through to the LLM so it can rescue the
   * intent using the activeClients roster. Used today by write-tools that
   * fail with `not_found` on a client name — the LLM may know the STT
   * mishearing maps to a real roster entry.
   */
  fallthroughToLLM?: boolean
}

export interface BookingEventData {
  appointmentId: string
  clientName:    string
  serviceName:   string
  date:          string
  time:          string
  action:        'created' | 'cancelled' | 'rescheduled'
}

// ── Notifications ──────────────────────────────────────────────────────────

export type NotificationType = 'appointment.created' | 'appointment.cancelled' | 'appointment.rescheduled'

export interface AppointmentNotification {
  eventId:     string
  type:        NotificationType
  businessId:  string
  userId:      string
  clientName:  string
  serviceName: string
  date:        string
  time:        string
}
