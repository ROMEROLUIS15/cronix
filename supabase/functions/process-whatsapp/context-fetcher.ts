/**
 * Context Fetcher — reads all data needed to build BusinessRagContext.
 * All functions are read-only and return empty arrays/null on error.
 */

import type { ServiceRow, ClientRow, ActiveAppointmentRow, ChatHistoryItem } from "./types.ts"
import { supabase } from "./db-client.ts"

export async function getBusinessServices(businessId: string): Promise<ServiceRow[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, duration_min, price')
    .eq('business_id', businessId)
    .eq('is_active', true)

  if (error) return []
  return (data ?? []) as ServiceRow[]
}

/**
 * Looks up a registered client by their WhatsApp phone number.
 * WhatsApp sends phones as bare digits (e.g. "584247092980") — uses fn_clean_phone
 * for reliable matching regardless of how the number was stored in the clients table.
 */
export async function getClientByPhone(
  businessId: string,
  phone:      string
): Promise<ClientRow | null> {
  const digits = phone.replace(/\D/g, '')

  const { data } = await supabase
    .rpc('fn_find_client_by_phone', {
      p_business_id:  businessId,
      p_phone_digits: digits,
    })

  if (!data || (data as ClientRow[]).length === 0) return null
  return (data as ClientRow[])[0]
}

/**
 * Fetches upcoming active appointments for a known client (max 5, next in time).
 */
export async function getActiveAppointments(
  businessId: string,
  clientId:   string
): Promise<ActiveAppointmentRow[]> {
  // Look back 4 hours so appointments that have already started today
  // (but not yet ended) remain visible for same-day cancellation requests.
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('appointments')
    .select('id, start_at, end_at, status, services(name)')
    .eq('business_id', businessId)
    .eq('client_id', clientId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', since)
    .order('start_at', { ascending: true })
    .limit(5)

  if (!data) return []

  return (data as Array<{
    id: string; start_at: string; end_at: string; status: string
    services: { name: string } | null
  }>).map(row => ({
    id:           row.id,
    service_name: row.services?.name ?? 'Servicio',
    start_at:     row.start_at,
    end_at:       row.end_at,
    status:       row.status,
  }))
}

/**
 * Fetches recent conversation turns from wa_audit_logs for context injection.
 * Returns interleaved user/model ChatHistoryItems in chronological order.
 */
export async function getConversationHistory(
  businessId:  string,
  senderPhone: string,
  limit:       number = 2
): Promise<ChatHistoryItem[]> {
  const { data } = await supabase
    .from('wa_audit_logs')
    .select('message_text, ai_response')
    .eq('business_id', businessId)
    .eq('sender_phone', senderPhone)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) return []

  const rows  = data as Array<{ message_text: string; ai_response: string | null }>
  const items: ChatHistoryItem[] = []

  for (const row of rows.reverse()) {
    items.push({ role: 'user',  text: row.message_text })
    if (row.ai_response) items.push({ role: 'model', text: row.ai_response })
  }

  return items
}

/**
 * Fetches upcoming booked time slots (next 14 days) converted to local time strings.
 * Injected into the AI prompt so it never suggests an already-taken slot.
 */
export async function getBookedSlots(
  businessId: string,
  timezone:   string
): Promise<Array<{ start_at: string; end_at: string }>> {
  const now      = new Date()
  const in7days  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const { data } = await supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled","no_show")')
    .gte('start_at', now.toISOString())
    .lte('start_at', in7days.toISOString())
    .order('start_at', { ascending: true })

  if (!data) return []

  return (data as Array<{ start_at: string; end_at: string }>).map(row => ({
    start_at: new Date(row.start_at).toLocaleString('es-ES', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric', hour12: true,
    }),
    end_at: new Date(row.end_at).toLocaleString('es-ES', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: true,
    }),
  }))
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
