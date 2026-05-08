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
}

export interface AgentOutput {
  text:            string
  actionPerformed: boolean
  history:         Array<{ role: 'user' | 'assistant'; content: string }>
  modelUsed:       string
  /** Bell notifications captured during this turn (fired AFTER response). */
  pendingNotifications: AppointmentNotification[]
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
