/**
 * Appointment Repository — all appointment mutations.
 * All writes are scoped by business_id to prevent IDOR attacks.
 */

import type { AppointmentPayload, BookingResult } from "./types.ts"
import { supabase }      from "./db-client.ts"
import { localTimeToUTC } from "./time-utils.ts"

/**
 * Creates a new appointment via the secure RPC.
 * The RPC creates the client if they don't exist and enforces slot-conflict checks.
 * Returns BookingResult — callers must check result.success for business-logic failures.
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
  return data as BookingResult
}

/**
 * Fetches full appointment details (service name, client name+phone, start_at, business_id).
 * Called before mutations to populate notifications and validate ownership.
 */
export async function getAppointmentDetails(appointmentId: string): Promise<{
  start_at:    string
  business_id: string
  services:    { name: string } | null
  clients:     { name: string; phone?: string } | null
} | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select('start_at, business_id, services:service_id(name), clients:client_id(name, phone)')
    .eq('id', appointmentId)
    .single()

  if (error || !data) return null
  return data as {
    start_at: string; business_id: string
    services: { name: string } | null
    clients:  { name: string; phone?: string } | null
  }
}

/**
 * Reschedules an appointment, preserving the original duration.
 * Verifies business ownership twice (fetch + update) to prevent IDOR.
 */
export async function rescheduleAppointment(
  appointmentId: string,
  newStartAt:    string,
  businessId:    string
): Promise<void> {
  const { data: original, error: fetchErr } = await supabase
    .from('appointments')
    .select('start_at, end_at, business_id')
    .eq('id', appointmentId)
    .eq('business_id', businessId)
    .single()

  if (fetchErr || !original) {
    throw new Error(`rescheduleAppointment: appointment ${appointmentId} not found or access denied`)
  }

  const apt        = original as { start_at: string; end_at: string }
  const durationMs = new Date(apt.end_at).getTime() - new Date(apt.start_at).getTime()
  const newEndAt   = new Date(new Date(newStartAt).getTime() + durationMs).toISOString()

  const { error: updateErr } = await supabase
    .from('appointments')
    .update({ start_at: newStartAt, end_at: newEndAt, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('business_id', businessId)

  if (updateErr) throw new Error(`rescheduleAppointment update failed: ${updateErr.message}`)
}

/**
 * Cancels an appointment by setting status to 'cancelled'.
 * Verifies business ownership to prevent IDOR.
 */
export async function cancelAppointmentById(
  appointmentId: string,
  businessId:    string
): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('business_id', businessId)

  if (error) throw new Error(`cancelAppointmentById failed: ${error.message}`)
}
