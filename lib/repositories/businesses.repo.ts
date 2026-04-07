/**
 * Businesses Repository — Supabase queries for the businesses table.
 *
 * Exposes:
 *  - createBusiness:  insert a new business row and return it
 *
 * Does NOT expose:
 *  - Read queries (handled by useBusinessContext in users.repo)
 *  - Settings updates (handled by settings page directly — future migration)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Client = SupabaseClient<Database>
type BusinessInsert = Database['public']['Tables']['businesses']['Insert']
type BusinessRow = Database['public']['Tables']['businesses']['Row']

/**
 * Generates a URL-safe slug for WhatsApp deep-links.
 * Format: <sanitized-name>-<6-char random suffix>
 * The random suffix prevents slug enumeration across businesses.
 */
export function generateBusinessSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')       // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')           // trim leading/trailing hyphens
    .slice(0, 20)
  const suffix = Math.random().toString(36).slice(2, 8)
  return base ? `${base}-${suffix}` : suffix
}

/**
 * Returns the settings JSON for a business.
 * Used by appointment forms to check notification preferences, working hours, etc.
 */
export async function getBusinessSettings(
  supabase: Client,
  businessId: string
): Promise<{ settings: Record<string, unknown> | null }> {
  const { data, error } = await supabase
    .from('businesses')
    .select('settings')
    .eq('id', businessId)
    .single()

  if (error) throw new Error(`Error fetching business settings: ${error.message}`)
  return { settings: data?.settings as Record<string, unknown> | null }
}

/**
 * Creates a new business and returns the created row.
 * Throws on error to let the caller handle presentation.
 */
export async function createBusiness(
  supabase: Client,
  data: Pick<BusinessInsert, 'name' | 'category' | 'owner_id' | 'plan'> & { timezone?: string }
): Promise<BusinessRow> {
  const { data: business, error } = await supabase
    .from('businesses')
    .insert({ ...data, slug: generateBusinessSlug(data.name) })
    .select()
    .single()

  if (error) throw new Error(`Error creating business: ${error.message}`)
  return business
}

/**
 * Returns just the business name (for AI notification context).
 */
export async function getBusinessName(
  supabase: Client,
  businessId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('businesses')
    .select('name')
    .eq('id', businessId)
    .single()

  return data?.name ?? null
}
