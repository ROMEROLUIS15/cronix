import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"
import type {
  BusinessRow,
  ServiceRow,
  ClientRow,
  ActiveAppointmentRow,
  ChatHistoryItem,
  AppointmentPayload,
  AuditLogData,
  BookingResult,
} from "./types.ts"

/**
 * Database operations for the WhatsApp AI Agent.
 * All mutations delegate to RPC functions for atomicity and RLS safety.
 * Direct table updates (reschedule, cancel) are scoped by appointment ID
 * and protected by RLS — only the owning business can modify its appointments.
 */

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a local date + time string to a UTC ISO timestamp.
 * Uses the current moment's UTC offset for the given IANA timezone.
 * NOTE: DST-unaware; accurate for fixed-offset timezones (most of LatAm).
 */
export function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const now      = new Date()
  const utcMs    = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzMs     = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime()
  const offsetMs = tzMs - utcMs
  const localMs  = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
  return new Date(localMs - offsetMs).toISOString()
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

/**
 * Returns true if the sender is within the allowed message rate.
 * Fails open (returns true) on DB error to avoid blocking legitimate users.
 */
export async function checkMessageRateLimit(senderPhone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_rate_limit', {
    p_sender:      senderPhone,
    p_window_secs: 60,
    p_max_msgs:    10,
  })
  if (error) return true  // fail-open
  return data as boolean
}

/**
 * Returns true if the sender hasn't exceeded the booking limit for this business.
 * Fails open on DB error.
 */
export async function checkBookingRateLimit(
  senderPhone: string,
  businessId:  string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_booking_limit', {
    p_sender:       senderPhone,
    p_business_id:  businessId,
    p_window_secs:  86400,
    p_max_bookings: 2,
  })
  if (error) return true  // fail-open
  return data as boolean
}

// ── Business routing (single shared number → slug + session) ─────────────────

/**
 * Resolves a business by its URL-safe slug (e.g. "#rs-studio" → RS Studio).
 * Used as the primary routing mechanism when the user includes #slug in their message.
 */
export async function getBusinessBySlug(slug: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, timezone, settings')
    .eq('slug', slug)
    .single()

  if (error || !data) return null
  return data as BusinessRow
}

/**
 * Retrieves the last business a sender interacted with from wa_sessions.
 * Fallback when no #slug is present in the message.
 */
export async function getSessionBusiness(senderPhone: string): Promise<BusinessRow | null> {
  const { data: session, error: sessionErr } = await supabase
    .from('wa_sessions')
    .select('business_id')
    .eq('sender_phone', senderPhone)
    .single()

  if (sessionErr || !session) return null

  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, timezone, settings')
    .eq('id', (session as { business_id: string }).business_id)
    .single()

  if (error || !data) return null
  return data as BusinessRow
}

/**
 * Anchors a sender to a business in wa_sessions.
 * Called when a #slug resolves successfully, so future messages without slug
 * automatically route to the same business.
 */
export async function upsertSession(senderPhone: string, businessId: string): Promise<void> {
  await supabase
    .from('wa_sessions')
    .upsert(
      { sender_phone: senderPhone, business_id: businessId, updated_at: new Date().toISOString() },
      { onConflict: 'sender_phone' }
    )
}

/**
 * Legacy: resolves business by WhatsApp phone number ID or display phone.
 * Only useful if a business has a dedicated WhatsApp number.
 */
export async function getBusinessByPhone(waIdentifier: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .rpc('fn_get_business_by_phone', { p_wa_phone_id: waIdentifier })

  if (error || !data || (data as BusinessRow[]).length === 0) return null
  return (data as BusinessRow[])[0]
}

// ── Services ──────────────────────────────────────────────────────────────────

export async function getBusinessServices(businessId: string): Promise<ServiceRow[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, duration_min, price')
    .eq('business_id', businessId)
    .eq('is_active', true)

  if (error) return []
  return (data ?? []) as ServiceRow[]
}

// ── Client context ────────────────────────────────────────────────────────────

/**
 * Looks up a registered client by their WhatsApp phone number.
 * Returns null for new (unregistered) contacts.
 *
 * WhatsApp sends phones as bare digits (e.g. "584247092980") but the clients
 * table stores them with formatting (e.g. "+58 4247092980", "+58 04247092980").
 * Uses fn_clean_phone (DB function that strips non-digits) for reliable matching.
 */
export async function getClientByPhone(
  businessId: string,
  phone:      string
): Promise<ClientRow | null> {
  const digits = phone.replace(/\D/g, '')

  // Use the existing fn_clean_phone DB function for server-side comparison
  const { data } = await supabase
    .rpc('fn_find_client_by_phone', {
      p_business_id: businessId,
      p_phone_digits: digits,
    })

  if (!data || (data as ClientRow[]).length === 0) return null
  return (data as ClientRow[])[0]
}

/**
 * Fetches upcoming active appointments (pending or confirmed) for a known client.
 * Limited to the next 5 appointments to keep the prompt concise.
 */
export async function getActiveAppointments(
  businessId: string,
  clientId:   string
): Promise<ActiveAppointmentRow[]> {
  const { data } = await supabase
    .from('appointments')
    .select('id, start_at, end_at, status, services(name)')
    .eq('business_id', businessId)
    .eq('client_id', clientId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(5)

  if (!data) return []

  return (data as Array<{
    id:       string
    start_at: string
    end_at:   string
    status:   string
    services: { name: string } | null
  }>).map(row => ({
    id:           row.id,
    service_name: row.services?.name ?? 'Servicio',
    start_at:     row.start_at,
    end_at:       row.end_at,
    status:       row.status,
  }))
}

// ── Conversation history ──────────────────────────────────────────────────────

/**
 * Fetches recent conversation turns from wa_audit_logs for context injection.
 * Returns interleaved user/model ChatHistoryItems in chronological order.
 *
 * @param limit - Number of past exchanges to fetch (each exchange = 1 user + 1 model item)
 */
export async function getConversationHistory(
  businessId:  string,
  senderPhone: string,
  limit:       number = 4
): Promise<ChatHistoryItem[]> {
  const { data } = await supabase
    .from('wa_audit_logs')
    .select('message_text, ai_response')
    .eq('business_id', businessId)
    .eq('sender_phone', senderPhone)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) return []

  const rows = data as Array<{ message_text: string; ai_response: string | null }>
  const items: ChatHistoryItem[] = []

  // Reverse to chronological order, then flatten into alternating user/model items
  for (const row of rows.reverse()) {
    items.push({ role: 'user',  text: row.message_text })
    if (row.ai_response) {
      items.push({ role: 'model', text: row.ai_response })
    }
  }

  return items
}

// ── Available slots ───────────────────────────────────────────────────────────

export async function getAvailableSlots(
  businessId: string,
  date:       string,
  serviceId:  string,
  timezone  = 'UTC'
): Promise<string[]> {
  const { data, error } = await supabase.rpc('fn_get_available_slots', {
    p_business_id: businessId,
    p_date:        date,
    p_service_id:  serviceId,
    p_timezone:    timezone,
  })

  if (error) return []
  return (data as { slot_time: string }[]).map(d => d.slot_time)
}

// ── Appointment mutations ─────────────────────────────────────────────────────

/**
 * Creates a new appointment via the secure RPC.
 * The RPC creates the client if they don't exist and enforces business rules.
 */
export async function createAppointment(
  businessId: string,
  payload:    AppointmentPayload
): Promise<BookingResult> {
  const startAt = localTimeToUTC(payload.date, payload.time, payload.timezone)

  const { data, error } = await supabase.rpc('fn_book_appointment_wa', {
    p_business_id:  businessId,
    p_client_phone: payload.client_phone,
    p_client_name:  payload.client_name,
    p_service_id:   payload.service_id,
    p_start_at:     startAt,
  })

  if (error) throw new Error(`createAppointment RPC error: ${error.message}`)

  const result = data as BookingResult
  if (!result?.success) throw new Error(result?.error ?? 'fn_book_appointment_wa returned failure')

  return result
}

/**
 * Reschedules an appointment by recalculating end_at from the original duration.
 * Fetches the original appointment to preserve duration — no duration param needed.
 */
export async function rescheduleAppointment(
  appointmentId: string,
  newStartAt:    string
): Promise<void> {
  const { data: original, error: fetchErr } = await supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('id', appointmentId)
    .single()

  if (fetchErr || !original) {
    throw new Error(`rescheduleAppointment: appointment ${appointmentId} not found`)
  }

  const apt        = original as { start_at: string; end_at: string }
  const durationMs = new Date(apt.end_at).getTime() - new Date(apt.start_at).getTime()
  const newEndAt   = new Date(new Date(newStartAt).getTime() + durationMs).toISOString()

  const { error: updateErr } = await supabase
    .from('appointments')
    .update({ start_at: newStartAt, end_at: newEndAt, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)

  if (updateErr) throw new Error(`rescheduleAppointment update failed: ${updateErr.message}`)
}

/**
 * Cancels an appointment by setting its status to 'cancelled'.
 */
export async function cancelAppointmentById(appointmentId: string): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', appointmentId)

  if (error) throw new Error(`cancelAppointmentById failed: ${error.message}`)
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function logInteraction(data: AuditLogData): Promise<void> {
  await supabase.from('wa_audit_logs').insert([data])
}
