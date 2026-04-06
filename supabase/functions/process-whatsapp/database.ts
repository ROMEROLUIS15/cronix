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
import { captureException } from "../_shared/sentry.ts"

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
 * Uses Intl.DateTimeFormat to reliably find the exact offset for the target timezone,
 * avoiding historical timezone drift bugs (e.g. Venezuela's old -04:30 offset).
 */
export function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): string {
  // Anchor the time as if it were UTC to extract the target timezone's exact GMT offset
  const targetDate = new Date(`${dateStr}T${timeStr}:00Z`)
  
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
  const parts = formatter.formatToParts(targetDate)
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value // e.g. "GMT-04:00"
  
  if (offsetPart && offsetPart.startsWith('GMT')) {
    const offsetStr = offsetPart.replace('GMT', '') // Yields "-04:00", "+02:00", or "" (if UTC)
    if (!offsetStr) return `${dateStr}T${timeStr}:00Z`
    return new Date(`${dateStr}T${timeStr}:00${offsetStr}`).toISOString()
  }
  
  // Fallback if parsing fails
  return new Date(`${dateStr}T${timeStr}:00Z`).toISOString()
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

/**
 * Returns true if the business is within its allowed message quota.
 * Protects against aggregate floods per tenant. Fails open on DB error.
 */
export async function checkBusinessUsageLimit(businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_business_limit', {
    p_business_id: businessId,
    p_window_secs: 60,
    p_max_msgs:    50,
  })
  if (error) return true  // fail-open
  return data as boolean
}

// ── Circuit Breaker (Third-party protection) ──────────────────────────────────

/**
 * Returns true if the service is allowed to be called (circuit is CLOSED).
 */
export async function checkCircuitBreaker(serviceName: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_circuit_breaker', {
    p_service_name: serviceName,
    p_reset_mins:   2
  })
  if (error) return true  // fail-open
  return data as boolean
}

/**
 * Reports a service failure to the circuit breaker.
 */
export async function reportServiceFailure(serviceName: string): Promise<void> {
  await supabase.rpc('fn_wa_report_service_failure', {
    p_service_name: serviceName,
    p_threshold:    3
  })
}

/**
 * Reports a service success to the circuit breaker.
 */
export async function reportServiceSuccess(serviceName: string): Promise<void> {
  await supabase.rpc('fn_wa_report_service_success', {
    p_service_name: serviceName
  })
}

// ── Token Quota (Cost control) ────────────────────────────────────────────────

/**
 * Returns true if the business is within its allowed token quota for today.
 */
export async function checkTokenQuota(businessId: string, dailyLimit: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_token_quota', {
    p_business_id: businessId,
    p_daily_limit: dailyLimit,
  })
  if (error) return true // fail-open
  return data as boolean
}

/**
 * Updates the token consumption for a business today.
 */
export async function trackTokenUsage(businessId: string, tokens: number): Promise<void> {
  await supabase.rpc('fn_wa_track_token_usage', {
    p_business_id: businessId,
    p_tokens:      tokens,
  })
}

// ── Business routing (single shared number → slug + session) ─────────────────

/**
 * Resolves a business by its URL-safe slug (e.g. "#rs-studio" → RS Studio).
 * Used as the primary routing mechanism when the user includes #slug in their message.
 */
export async function getBusinessBySlug(slug: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, phone, timezone, settings')
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
    .select('id, name, phone, timezone, settings')
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

/**
 * Updates the business phone number and sets wa_verified to true in settings.
 * Returns the business name if successful, null otherwise.
 */
export async function verifyBusinessPhone(slug: string, phone: string): Promise<string | 'ALREADY_VERIFIED' | null> {
  const business = await getBusinessBySlug(slug)
  if (!business) return null

  // Check if it's already verified with the SAME or different phone
  const settings = (business.settings ?? {}) as Record<string, any>
  if (settings.wa_verified === true && business.phone === phone) {
    return 'ALREADY_VERIFIED'
  }

  const newSettings = {
    ...settings,
    wa_verified: true
  }

  const { data, error } = await supabase
    .from('businesses')
    .update({ 
      phone: phone, 
      settings: newSettings as any 
    })
    .eq('slug', slug)
    .select('name')
    .single()

  if (error || !data) {
    captureException(error || new Error('Unknown error updating phone'), { stage: 'db_verify_phone', slug })
    return null
  }

  // Audit trail for success
  await logInteraction({
    business_id:  business.id,
    sender_phone: phone,
    message_text: `[SYSTEM] VINCULAR-${slug}`,
    ai_response:  `Business verified/updated: ${data.name}`,
  })
  
  return data.name
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

/**
 * Fetches upcoming booked time slots for the business (next 14 days).
 * Used to inject into the AI prompt so it never suggests an already-taken slot.
 */
export async function getBookedSlots(
  businessId: string,
  timezone:   string
): Promise<Array<{ start_at: string; end_at: string }>> {
  const now      = new Date()
  const in14days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  const { data } = await supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled","no_show")')
    .gte('start_at', now.toISOString())
    .lte('start_at', in14days.toISOString())
    .order('start_at', { ascending: true })

  if (!data) return []

  // Convert to local time strings for the AI prompt
  return (data as Array<{ start_at: string; end_at: string }>).map(row => {
    const startLocal = new Date(row.start_at).toLocaleString('es-ES', { timeZone: timezone, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hour12: true })
    const endLocal   = new Date(row.end_at).toLocaleString('es-ES', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: true })
    return { start_at: startLocal, end_at: endLocal }
  })
}

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
 *
 * Throws only on true DB/network errors.
 * Returns the BookingResult (with success=false and error key) for expected
 * business failures like slot conflicts — callers must check result.success.
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

  // True DB/network failure: surface it as an exception so Sentry catches it correctly
  if (error) throw new Error(`createAppointment RPC error: ${error.message}`)

  // Business logic failure (e.g. slot already taken): return as-is for the caller to handle gracefully
  return data as BookingResult
}

/**
 * Fetches the full details of an appointment for notifications before it's mutated.
 */
export async function getAppointmentDetails(appointmentId: string): Promise<any> {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      start_at,
      services:service_id(name),
      clients:client_id(name, phone)
    `)
    .eq('id', appointmentId)
    .single()

  if (error || !data) return null
  return data
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
  await supabase.from("wa_audit_logs").insert([data]);
}

/**
 * Creates an in-app notification for the business dashboard.
 * Used by Luis IA to report actions like bookings, cancellations, or issues.
 */
export async function createInternalNotification(
  businessId: string,
  title: string,
  content: string,
  type: "info" | "success" | "warning" | "error" = "info",
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .insert([{
      business_id: businessId,
      title,
      content,
      type,
      metadata
    }]);

  if (error) {
    throw new Error(`Failed to create internal notification: ${error.message}`);
  }
}

