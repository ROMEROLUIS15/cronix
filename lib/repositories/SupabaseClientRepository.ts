/**
 * SupabaseClientRepository — Concrete implementation of IClientRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail, toErrorMessage } from '@/types/result'
import {
  IClientRepository,
  ClientForSelect,
  ClientForAI,
  InsertClientPayload
} from '@/lib/domain/repositories/IClientRepository'
import type { Client, ClientAppointmentWithDetails } from '@/types'
import cache, { TTL, TTL_SEC } from '@/lib/cache'

type SupaClient = SupabaseClient<Database>

export class SupabaseClientRepository implements IClientRepository {
  constructor(private supabase: SupaClient) {}

  async getAll(businessId: string): Promise<Result<Client[]>> {
    const cached = await cache.get<Client[]>(businessId, 'clients', 'all')
    if (cached) return ok(cached)

    const { data, error } = await this.supabase
      .from('clients')
      .select('id, business_id, name, phone, email, avatar_url, notes, tags, total_appointments, total_spent, last_visit_at, created_at, updated_at, deleted_at')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('name')

    if (error) return fail(`Error fetching clients: ${error.message}`)
    const result = (data ?? []) as Client[]
    await cache.set(businessId, 'clients', 'all', result, TTL_SEC.CLIENTS)
    return ok(result)
  }

  async getAllForSelect(businessId: string): Promise<Result<ClientForSelect[]>> {
    const cached = await cache.get<ClientForSelect[]>(businessId, 'clients', 'select')
    if (cached) return ok(cached)

    const { data, error } = await this.supabase
      .from('clients')
      .select('id, name, phone, email')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('name')

    if (error) return fail(`Error fetching clients for select: ${error.message}`)
    const result: ClientForSelect[] = (data ?? []) as ClientForSelect[]
    await cache.set(businessId, 'clients', 'select', result, TTL_SEC.CLIENTS)
    return ok(result)
  }

  async getById(clientId: string, businessId: string): Promise<Result<Client | null>> {
    const { data, error } = await this.supabase
      .from('clients')
      .select('id, business_id, name, phone, email, avatar_url, notes, tags, total_appointments, total_spent, last_visit_at, created_at, updated_at, deleted_at')
      .eq('id', clientId)
      .eq('business_id', businessId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return ok(null)
      return fail(`Error fetching client: ${error.message}`)
    }
    return ok(data as Client)
  }

  async getAppointments(
    clientId: string,
    businessId: string
  ): Promise<Result<ClientAppointmentWithDetails[]>> {
    const { data, error } = await this.supabase
      .from('appointments')
      .select('id, start_at, end_at, status, is_dual_booking, notes, client_id, service:services(id, name, color, price, duration_min), transactions(net_amount, amount)')
      .eq('client_id', clientId)
      .eq('business_id', businessId)
      .order('start_at', { ascending: false })

    if (error) return fail(`Error fetching client appointments: ${error.message}`)
    return ok((data as unknown as ClientAppointmentWithDetails[]) ?? [])
  }

  async findActiveForAI(businessId: string): Promise<Result<ClientForAI[]>> {
    const { data, error } = await this.supabase
      .from('clients')
      .select('id, name, phone')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .limit(200)

    if (error) return fail(`findActiveForAI: ${error.message}`)
    return ok((data ?? []) as ClientForAI[])
  }

  async insert(payload: InsertClientPayload): Promise<Result<ClientForAI>> {
    const { data: row, error } = await this.supabase
      .from('clients')
      .insert(payload)
      .select('id, name, phone')
      .single()

    if (error || !row) return fail(`insertClient: ${error?.message}`)

    if (row) {
      // Invalidate client caches — we need businessId but payload might not have it
      // The row doesn't have business_id in the select, so we skip invalidation here
      // Callers should invalidate manually if needed
    }
    return ok(row as ClientForAI)
  }

  async findInactive(
    businessId: string,
    sixtyDaysAgo: string
  ): Promise<Result<{ name: string }[]>> {
    const { data, error } = await this.supabase.rpc('get_inactive_clients_rpc', {
      biz_id: businessId,
      sixty_days_ago: sixtyDaysAgo,
    })

    if (error) return fail(`callInactiveClientsRpc: ${error.message}`)
    return ok((data ?? []) as { name: string }[])
  }
}
