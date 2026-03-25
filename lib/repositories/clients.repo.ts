/**
 * Clients Repository — Supabase queries for clients.
 *
 * Exposes:
 *  - getClients:      list all active clients for a business
 *  - getClientById:   full client detail
 *  - getClientAppointments: client appointments with service + transactions
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Client as ClientType, ClientAppointmentWithDetails } from '@/types'

type SupaClient = SupabaseClient<Database>

/**
 * Returns all active clients (not soft-deleted) for a business.
 */
export async function getClients(
  supabase: SupaClient,
  businessId: string
): Promise<ClientType[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, business_id, name, phone, email, avatar_url, notes, birthday, tags, total_appointments, total_spent, last_visit_at, created_at, updated_at, deleted_at')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw new Error(`Error fetching clients: ${error.message}`)
  return (data ?? []) as ClientType[]
}

/**
 * Returns minimal client data for form dropdowns.
 */
export async function getClientsForSelect(
  supabase: SupaClient,
  businessId: string
) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, phone, email')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw new Error(`Error fetching clients for select: ${error.message}`)
  return data ?? []
}

/**
 * Returns a single client by ID (with business isolation).
 */
export async function getClientById(
  supabase: SupaClient,
  clientId: string,
  businessId: string
): Promise<ClientType | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, business_id, name, phone, email, avatar_url, notes, birthday, tags, total_appointments, total_spent, last_visit_at, created_at, updated_at, deleted_at')
    .eq('id', clientId)
    .eq('business_id', businessId)
    .single()

  if (error) return null
  return data as ClientType
}

/**
 * Returns client appointments with service and transaction details.
 */
export async function getClientAppointments(
  supabase: SupaClient,
  clientId: string,
  businessId: string
): Promise<ClientAppointmentWithDetails[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, start_at, end_at, status, is_dual_booking, notes, client_id, service:services(id, name, color, price, duration_min), transactions(net_amount, amount)')
    .eq('client_id', clientId)
    .eq('business_id', businessId)
    .order('start_at', { ascending: false })

  if (error) throw new Error(`Error fetching client appointments: ${error.message}`)
  return (data as unknown as ClientAppointmentWithDetails[]) ?? []
}
