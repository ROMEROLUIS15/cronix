/**
 * types.ts — Input DTOs for all use cases.
 *
 * These are the ONLY shapes the orchestrator (via ToolAdapters) sends to use cases.
 * Use cases never accept raw LLM arguments or channel-specific formats.
 */

// ── Appointment Use Cases ────────────────────────────────────────────────────

export interface CreateAppointmentInput {
  businessId: string
  clientId: string
  serviceIds: string[]
  startAt: string     // ISO 8601 with timezone offset
  endAt: string       // ISO 8601 with timezone offset
  notes?: string | null
  assignedUserId?: string | null
}

export interface CreateAppointmentOutput {
  id: string
  businessId: string
  clientId: string
  status: string
}

export interface CancelAppointmentInput {
  businessId: string
  appointmentId: string
}

export interface RescheduleAppointmentInput {
  businessId: string
  appointmentId: string
  newStartAt: string  // ISO 8601
  newEndAt: string    // ISO 8601
}

export interface GetAppointmentsByDateInput {
  businessId: string
  date: string        // YYYY-MM-DD
  timezone: string
}

export interface AppointmentSummary {
  id: string
  time: string        // e.g. "3:00 pm"
  clientName: string
  serviceName: string
  status: string
}

// ── Client Use Cases ─────────────────────────────────────────────────────────

export interface GetClientsInput {
  businessId: string
  query?: string
}

export interface ClientSummary {
  id: string
  name: string
  phone: string | null
  email: string | null
}

// ── Finance Use Cases ────────────────────────────────────────────────────────

export interface RegisterPaymentInput {
  businessId: string
  appointmentId: string
  amount: number
  method: string      // 'cash' | 'transfer' | 'card' | etc.
  notes?: string
}

// ── Service Use Cases ────────────────────────────────────────────────────────

export interface GetServicesInput {
  businessId: string
}

export interface ServiceSummary {
  id: string
  name: string
  durationMin: number
  price: number
  isActive: boolean
}
