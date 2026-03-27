import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

/**
 * Database operations for the AI Appointment Agent.
 * Delegates all logic to secure RPC functions for atomicity and security.
 */

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// ── Domain types ──────────────────────────────────────────────────────────────

export interface BusinessRow {
  id:       string
  name:     string
  timezone: string | null
  settings: Record<string, unknown>
}

export interface ServiceRow {
  id:           string
  name:         string
  duration_min: number
  price:        number | null
}

export interface AppointmentPayload {
  client_phone: string
  client_name:  string
  service_id:   string
  date:         string
  time:         string
  timezone:     string
}

interface BookingResult {
  success:          boolean
  appointment_id?:  string
  error?:           string
}

interface AuditLogData {
  business_id:  string
  sender_phone: string
  message_text: string
  ai_response?: string
  tool_calls?:  Record<string, unknown>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a local date+time string to a UTC ISO timestamp.
 * Uses the current moment's UTC offset for the given timezone.
 * NOTE: DST-unaware; accurate for fixed-offset timezones (most of LatAm).
 */
function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const now      = new Date()
  const utcMs    = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzMs     = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime()
  const offsetMs = tzMs - utcMs
  const localMs  = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
  return new Date(localMs - offsetMs).toISOString()
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getBusinessByPhone(waIdentifier: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase
    .rpc('fn_get_business_by_phone', { p_wa_phone_id: waIdentifier })

  if (error || !data || (data as BusinessRow[]).length === 0) {
    return null
  }

  return (data as BusinessRow[])[0]
}

export async function getBusinessServices(businessId: string): Promise<ServiceRow[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, duration_min, price')
    .eq('business_id', businessId)
    .eq('is_active', true)

  if (error) {
    return []
  }

  return (data ?? []) as ServiceRow[]
}

export async function getAvailableSlots(
  businessId: string,
  date:       string,
  serviceId:  string,
  timezone =  'UTC'
): Promise<string[]> {
  const { data, error } = await supabase
    .rpc('fn_get_available_slots', {
      p_business_id: businessId,
      p_date:        date,
      p_service_id:  serviceId,
      p_timezone:    timezone
    })

  if (error) {
    return []
  }

  return (data as { slot_time: string }[]).map(d => d.slot_time)
}

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
    p_start_at:     startAt
  })

  if (error) {
    throw error
  }

  const result = data as BookingResult
  if (!result?.success) {
    throw new Error(result?.error ?? 'No se pudo realizar el agendamiento.')
  }

  return result
}

export async function logInteraction(data: AuditLogData): Promise<void> {
  await supabase.from('wa_audit_logs').insert([data])
}
