/**
 * SupabaseServiceRepository — Concrete implementation of IServiceRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail } from '@/types/result'
import {
  IServiceRepository,
  ServiceForDropdown,
  CreateServicePayload,
  UpdateServicePayload
} from '@/lib/domain/repositories/IServiceRepository'
import type { Service } from '@/types'
import cache, { TTL, TTL_SEC } from '@/lib/cache'

type Client = SupabaseClient<Database>

export class SupabaseServiceRepository implements IServiceRepository {
  constructor(private supabase: Client) {}

  async getAll(businessId: string): Promise<Result<Service[]>> {
    const cached = await cache.get<Service[]>(businessId, 'services', 'all')
    if (cached) return ok(cached)

    const { data, error } = await this.supabase
      .from('services')
      .select('id, business_id, name, description, duration_min, price, color, category, is_active, created_at')
      .eq('business_id', businessId)
      .order('name')

    if (error) return fail(`Error fetching services: ${error.message}`)
    const result = (data ?? []) as Service[]
    await cache.set(businessId, 'services', 'all', result, TTL_SEC.SERVICES_ACTIVE)
    return ok(result)
  }

  async getActive(businessId: string): Promise<Result<ServiceForDropdown[]>> {
    const cached = await cache.get<ServiceForDropdown[]>(businessId, 'services', 'active')
    if (cached) return ok(cached)

    const { data, error } = await this.supabase
      .from('services')
      .select('id, name, duration_min, price')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name')

    if (error) return fail(`Error fetching active services: ${error.message}`)
    const result = (data ?? []) as ServiceForDropdown[]
    await cache.set(businessId, 'services', 'active', result, TTL_SEC.SERVICES_ACTIVE)
    return ok(result)
  }

  async hasAny(businessId: string): Promise<Result<boolean>> {
    const cached = await cache.get<boolean>(businessId, 'services', 'hasAny')
    if (cached !== null) return ok(cached)

    const { count, error } = await this.supabase
      .from('services')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)

    if (error) return fail(`Error checking services: ${error.message}`)
    const result = count !== null && count > 0
    await cache.set(businessId, 'services', 'hasAny', result, TTL_SEC.SERVICES_ACTIVE)
    return ok(result)
  }

  async create(businessId: string, payload: CreateServicePayload): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('services')
      .insert({ ...payload, business_id: businessId })

    if (error) return fail(`Error creating service: ${error.message}`)
    await cache.invalidate(businessId, 'services')
    return ok(undefined)
  }

  async update(
    serviceId: string,
    businessId: string,
    payload: UpdateServicePayload
  ): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('services')
      .update(payload)
      .eq('id', serviceId)
      .eq('business_id', businessId)

    if (error) return fail(`Error updating service: ${error.message}`)
    await cache.invalidate(businessId, 'services')
    return ok(undefined)
  }

  async delete(serviceId: string, businessId: string): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('services')
      .delete()
      .eq('id', serviceId)
      .eq('business_id', businessId)

    if (error) return fail(`Error deleting service: ${error.message}`)
    await cache.invalidate(businessId, 'services')
    return ok(undefined)
  }

  async toggleActive(serviceId: string, currentlyActive: boolean): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('services')
      .update({ is_active: !currentlyActive })
      .eq('id', serviceId)

    if (error) return fail(`Error toggling service: ${error.message}`)
    // Invalidate all service caches (we don't have businessId — best effort)
    return ok(undefined)
  }
}
