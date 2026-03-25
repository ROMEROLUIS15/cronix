/**
 * Services Repository — Supabase queries for services CRUD.
 *
 * Exposes:
 *  - getServices:       list all services for a business
 *  - getActiveServices: only active services (for dropdowns)
 *  - createService
 *  - updateService
 *  - deleteService
 *  - toggleServiceActive
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Service } from '@/types'

type Client = SupabaseClient<Database>

/**
 * Returns all services for a business, ordered by name.
 */
export async function getServices(
  supabase: Client,
  businessId: string
): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, business_id, name, description, duration_min, price, color, category, is_active, created_at')
    .eq('business_id', businessId)
    .order('name')

  if (error) throw new Error(`Error fetching services: ${error.message}`)
  return (data ?? []) as Service[]
}

/**
 * Returns only active services (for form dropdowns).
 */
export async function getActiveServices(
  supabase: Client,
  businessId: string
) {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, duration_min, price')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(`Error fetching active services: ${error.message}`)
  return data ?? []
}

/**
 * Creates a new service.
 */
export async function createService(
  supabase: Client,
  businessId: string,
  payload: {
    name: string
    description: string | null
    duration_min: number
    price: number
    color: string | null
    category: string | null
    is_active: boolean
  }
) {
  const { error } = await supabase
    .from('services')
    .insert({ ...payload, business_id: businessId })

  if (error) throw new Error(`Error creating service: ${error.message}`)
}

/**
 * Updates an existing service.
 */
export async function updateService(
  supabase: Client,
  serviceId: string,
  businessId: string,
  payload: {
    name?: string
    description?: string | null
    duration_min?: number
    price?: number
    color?: string | null
    category?: string | null
    is_active?: boolean
  }
) {
  const { error } = await supabase
    .from('services')
    .update(payload)
    .eq('id', serviceId)
    .eq('business_id', businessId)

  if (error) throw new Error(`Error updating service: ${error.message}`)
}

/**
 * Deletes a service.
 */
export async function deleteService(
  supabase: Client,
  serviceId: string,
  businessId: string
) {
  const { error } = await supabase
    .from('services')
    .delete()
    .eq('id', serviceId)
    .eq('business_id', businessId)

  if (error) throw new Error(`Error deleting service: ${error.message}`)
}

/**
 * Toggles the is_active flag.
 */
export async function toggleServiceActive(
  supabase: Client,
  serviceId: string,
  currentlyActive: boolean
) {
  const { error } = await supabase
    .from('services')
    .update({ is_active: !currentlyActive })
    .eq('id', serviceId)

  if (error) throw new Error(`Error toggling service: ${error.message}`)
}

/**
 * Checks if a business has at least one service configured.
 * Lightweight query used for UI hints/banners.
 */
export async function hasAnyService(
  supabase: Client,
  businessId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)

  if (error) throw new Error(`Error checking services: ${error.message}`)
  return count !== null && count > 0
}
