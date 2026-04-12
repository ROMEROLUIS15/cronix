/**
 * SupabaseBusinessRepository — Concrete implementation of IBusinessRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail } from '@/types/result'
import { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import type { Json } from '@/types/database.types'

type Client = SupabaseClient<Database>
type BusinessInsert = Database['public']['Tables']['businesses']['Insert']
type BusinessRow = Database['public']['Tables']['businesses']['Row']

/**
 * Generates a URL-safe slug for WhatsApp deep-links.
 */
export function generateBusinessSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
  const suffix = Math.random().toString(36).slice(2, 8)
  return base ? `${base}-${suffix}` : suffix
}

export class SupabaseBusinessRepository implements IBusinessRepository {
  constructor(private supabase: Client) {}

  async getSettings(businessId: string): Promise<Result<{ settings: Record<string, unknown> | null }>> {
    const { data, error } = await this.supabase
      .from('businesses')
      .select('settings')
      .eq('id', businessId)
      .single()

    if (error) return fail(`Error fetching business settings: ${error.message}`)
    return ok({ settings: data?.settings as Record<string, unknown> | null })
  }

  async create(data: Pick<BusinessInsert, 'name' | 'category' | 'owner_id' | 'plan'> & { timezone?: string }): Promise<Result<BusinessRow>> {
    const { data: business, error } = await this.supabase
      .from('businesses')
      .insert({ ...data, slug: generateBusinessSlug(data.name) })
      .select()
      .single()

    if (error) return fail(`Error creating business: ${error.message}`)
    return ok(business)
  }

  async getName(businessId: string): Promise<Result<string | null>> {
    const { data, error } = await this.supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single()

    if (error) return ok(null)
    return ok(data?.name ?? null)
  }

  async getById(businessId: string): Promise<Result<BusinessRow>> {
    const { data, error } = await this.supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single()

    if (error) return fail(`Error fetching business: ${error.message}`)
    return ok(data as BusinessRow)
  }

  async update(businessId: string, data: Partial<BusinessRow>): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('businesses')
      .update(data)
      .eq('id', businessId)

    if (error) return fail(`Error updating business: ${error.message}`)
    return ok(undefined)
  }

  async updateSettings(businessId: string, settings: Record<string, unknown>): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('businesses')
      .update({ settings: settings as Json })
      .eq('id', businessId)

    if (error) return fail(`Error updating business settings: ${error.message}`)
    return ok(undefined)
  }
}
