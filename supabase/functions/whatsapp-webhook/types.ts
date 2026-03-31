/**
 * Domain types for the WhatsApp AI Edge Function.
 *
 * These types are the SSOT for the Deno runtime. They mirror the relevant
 * subset of `types/index.ts` and `types/query-types.ts` from the main
 * Next.js app, but are self-contained because Edge Functions cannot import
 * from Node.js paths.
 *
 * Maintainability contract:
 *  - If `BusinessSettingsJson` changes in `types/query-types.ts`, update `WaBusinessSettings`.
 *  - If `clients`, `services`, or `appointments` columns change, update corresponding interfaces.
 */

// ── Business Settings (typed JSONB) ──────────────────────────────────────────

export interface WaBusinessSettings {
  ai_personality?:          string
  ai_rules?:                string
  working_hours?:           Record<string, [string, string] | null>
  wa_phone_number_id?:      string
  notifications?: {
    whatsapp: boolean
    email:    boolean
  }
  wa_verified?: boolean
  maxDailyBookingsPerClient?: number
}

// ── Database Row projections ─────────────────────────────────────────────────

export interface BusinessRow {
  id:       string
  name:     string
  phone:    string | null
  timezone: string | null
  settings: WaBusinessSettings | null
}

export interface ServiceRow {
  id:           string
  name:         string
  duration_min: number
  price:        number
}

export interface ClientRow {
  id:   string
  name: string
}

export interface ActiveAppointmentRow {
  id:           string
  service_name: string
  start_at:     string
  end_at:       string
  status:       string
}

export interface ChatHistoryItem {
  role: 'user' | 'model'
  text: string
}

// ── Aggregate Context (single fetch boundary) ────────────────────────────────

export interface BusinessRagContext {
  business: {
    id:       string
    name:     string
    timezone: string
    settings: WaBusinessSettings
  }
  services:           ServiceRow[]
  client:             ClientRow | null
  activeAppointments: ActiveAppointmentRow[]
  history:            ChatHistoryItem[]
}

// ── Payloads ─────────────────────────────────────────────────────────────────

export interface AppointmentPayload {
  client_phone: string
  client_name:  string
  service_id:   string
  date:         string
  time:         string
  timezone:     string
}

export interface AuditLogData {
  business_id:  string
  sender_phone: string
  message_text: string
  ai_response?: string
  tool_calls?:  Record<string, unknown>
}

// ── RPC Result ───────────────────────────────────────────────────────────────

export interface BookingResult {
  success:         boolean
  appointment_id?: string
  error?:          string
}

// ── Meta Webhook Types ───────────────────────────────────────────────────────

export interface MetaContact  { profile?: { name?: string } }
export interface MetaMessage  { from: string; text?: { body: string }; audio?: { id: string; mime_type?: string } }
export interface MetaMetadata { phone_number_id?: string; display_phone_number?: string }
export interface MetaValue    { messages?: MetaMessage[]; contacts?: MetaContact[]; metadata?: MetaMetadata }
export interface MetaEntry    { changes?: Array<{ value?: MetaValue }> }
export interface MetaWebhookPayload { object?: string; entry?: MetaEntry[] }

// ── AI Response Types (OpenAI-compatible — works with any OpenAI-API provider) ──
// Response types are defined locally in ai-agent.ts.
