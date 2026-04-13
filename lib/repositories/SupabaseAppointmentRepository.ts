/**
 * SupabaseAppointmentRepository — Concrete implementation of IAppointmentRepository.
 *
 * Implements: all domain contracts using Supabase as infra.
 * Guarantees: Result<T> return type, no exceptions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail, toErrorMessage } from '@/types/result'
import {
  IAppointmentRepository,
  AiApptRow,
  AppointmentDateRange,
  DashboardStats,
  CreateAppointmentPayload
} from '@/lib/domain/repositories/IAppointmentRepository'
import type { AppointmentWithRelations, SlotCheckAppointment } from '@/types'
import cache, { TTL, TTL_SEC } from '@/lib/cache'

type Client = SupabaseClient<Database>

const APPOINTMENT_SELECT = `
  id, start_at, end_at, status, is_dual_booking, notes,
  client:clients(id, name, phone, avatar_url),
  service:services(id, name, color, duration_min, price),
  appointment_services(sort_order, service:services(id, name, color, duration_min, price)),
  assigned_user:users(id, name, avatar_url, color)
` as const

export class SupabaseAppointmentRepository implements IAppointmentRepository {
  constructor(
    private supabase: Client,
    private financeRepo?: import('@/lib/domain/repositories/IFinanceRepository').IFinanceRepository
  ) {}

  async getMonthAppointments(
    businessId: string,
    rangeStart: string,
    rangeEnd: string
  ): Promise<Result<AppointmentWithRelations[]>> {
    // Check cache first
    const cached = await cache.get<AppointmentWithRelations[]>(
      businessId, 'appointments', `month:${rangeStart}:${rangeEnd}`
    )
    if (cached) return ok(cached)

    const { data, error } = await this.supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('business_id', businessId)
      .gte('start_at', `${rangeStart}T00:00:00`)
      .lte('start_at', `${rangeEnd}T23:59:59`)
      .order('start_at')

    if (error) return fail(`Error fetching month appointments: ${error.message}`)
    const result: AppointmentWithRelations[] = (data as AppointmentWithRelations[]) ?? []
    // Write to cache
    await cache.set(businessId, 'appointments', `month:${rangeStart}:${rangeEnd}`, result, TTL_SEC.APPOINTMENTS_MONTH)
    return ok(result)
  }

  async getDayAppointments(
    businessId: string,
    dateStr: string
  ): Promise<Result<AppointmentWithRelations[]>> {
    // Check cache first
    const cached = await cache.get<AppointmentWithRelations[]>(
      businessId, 'appointments', `day:${dateStr}`
    )
    if (cached) return ok(cached)

    const { data, error } = await this.supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('business_id', businessId)
      .gte('start_at', `${dateStr}T00:00:00`)
      .lte('start_at', `${dateStr}T23:59:59`)
      .order('start_at')

    if (error) return fail(`Error fetching day appointments: ${error.message}`)
    const result: AppointmentWithRelations[] = (data as AppointmentWithRelations[]) ?? []
    // Write to cache
    await cache.set(businessId, 'appointments', `day:${dateStr}`, result, TTL_SEC.APPOINTMENTS_DAY)
    return ok(result)
  }

  async getDaySlots(
    businessId: string,
    startISO: string,
    endISO: string
  ): Promise<Result<SlotCheckAppointment[]>> {
    const { data, error } = await this.supabase
      .from('appointments')
      .select('id, start_at, end_at, client_id, assigned_user_id')
      .eq('business_id', businessId)
      .gte('start_at', startISO)
      .lte('start_at', endISO)
      .not('status', 'in', '("cancelled","no_show")')

    if (error) return fail(`Error fetching day slots: ${error.message}`)
    return ok((data ?? []) as SlotCheckAppointment[])
  }

  async getForEdit(
    appointmentId: string,
    businessId: string
  ): Promise<Result<{
    id: string
    client_id: string
    service_id: string | null
    assigned_user_id: string | null
    start_at: string
    status: string
    notes: string | null
    appointment_services: { service_id: string; sort_order: number }[]
  } | null>> {
    type EditAppointmentShape = {
      id: string
      client_id: string
      service_id: string | null
      assigned_user_id: string | null
      start_at: string
      status: string
      notes: string | null
      appointment_services: { service_id: string; sort_order: number }[]
    }
    const { data, error } = await this.supabase
      .from('appointments')
      .select('id, client_id, service_id, assigned_user_id, start_at, status, notes, appointment_services(service_id, sort_order)')
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return ok(null)
      return fail(`Error fetching appointment for edit: ${error.message}`)
    }
    return ok(data as EditAppointmentShape)
  }

  async create(payload: CreateAppointmentPayload): Promise<Result<{ id: string; business_id: string; client_id: string; status: string }>> {
    const { service_ids, ...rest } = payload

    try {
      const { data: row, error } = await this.supabase
        .from('appointments')
        .insert({
          ...rest,
          // The trigger `trg_sync_service_junction` will automatically insert
          // service_ids[0] into appointment_services when service_id is set here.
          service_id: service_ids[0] ?? null,
          status: rest.status as Database['public']['Enums']['appointment_status'],
        })
        .select('id, business_id, client_id, status')
        .single()

      if (error || !row) return fail(`Error creating appointment: ${error?.message}`)

      // Only insert ADDITIONAL services (index 1+) into the junction table.
      // The trigger already inserted service_ids[0] with sort_order=0.
      // Using ON CONFLICT DO NOTHING as defensive guard.
      const extraServices = service_ids.slice(1)
      if (extraServices.length > 0) {
        const { error: jError } = await this.supabase
          .from('appointment_services')
          .upsert(
            extraServices.map((sid, i) => ({
              appointment_id: row.id,
              service_id:     sid,
              sort_order:     i + 1,
            })),
            { onConflict: 'appointment_id,service_id' }
          )
        if (jError) return fail(`Error creating services junction: ${jError.message}`)
      }

      // Invalidate cache for this business's appointments and dashboard stats
      await cache.invalidate(row.business_id, 'appointments')
      await cache.invalidateKey(row.business_id, 'dashboard', 'stats')

      return ok({
        ...row,
        status: row.status ?? 'pending',
      })
    } catch (e) {
      return fail(toErrorMessage(e))
    }
  }


  async updateStatus(
    appointmentId: string,
    status: string,
    businessId: string
  ): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('appointments')
      .update({
        status: status as Database['public']['Enums']['appointment_status'],
        updated_at: new Date().toISOString()
      })
      .eq('id', appointmentId)
      .eq('business_id', businessId)

    if (error) return fail(`Error updating appointment status: ${error.message}`)

    await cache.invalidate(businessId, 'appointments')
    await cache.invalidateKey(businessId, 'dashboard', 'stats')

    return ok(undefined)
  }

  async reschedule(
    appointmentId: string,
    startAt: string,
    endAt: string,
    businessId: string
  ): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('appointments')
      .update({
        start_at: startAt,
        end_at: endAt,
        status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('business_id', businessId)

    if (error) return fail(`Error rescheduling appointment: ${error.message}`)

    await cache.invalidate(businessId, 'appointments')
    await cache.invalidateKey(businessId, 'dashboard', 'stats')

    return ok(undefined)
  }

  async findConflicts(
    businessId: string,
    startAt: string,
    endAt: string,
    excludeId?: string
  ): Promise<Result<{ id: string }[]>> {
    let query = this.supabase
      .from('appointments')
      .select('id')
      .eq('business_id', businessId)
      .in('status', ['pending', 'confirmed'])
      .lt('start_at', endAt)
      .gt('end_at', startAt)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query
    if (error) return fail(`Error checking conflicts: ${error.message}`)
    return ok(data ?? [])
  }

  async findUpcomingByClient(
    businessId: string,
    clientId: string
  ): Promise<Result<AiApptRow[]>> {
    const { data, error } = await this.supabase
      .from('appointments')
      .select('id, start_at, service_id, assigned_user_id, services:service_id(name, duration_min)')
      .eq('business_id', businessId)
      .eq('client_id', clientId)
      .in('status', ['pending', 'confirmed'])
      .gte('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })

    if (error) return fail(`Error finding upcoming appointments: ${error.message}`)
    return ok((data ?? []) as AiApptRow[])
  }

  async findByDateRange(
    businessId: string,
    from: string,
    to: string,
    statuses?: string[]
  ): Promise<Result<AppointmentDateRange[]>> {
    let query = this.supabase
      .from('appointments')
      .select('id, start_at, end_at, status')
      .eq('business_id', businessId)
      .gte('start_at', from)
      .lte('start_at', to)
      .order('start_at', { ascending: true })

    if (statuses?.length) {
      type StatusEnum = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | null
      query = query.in('status', statuses as readonly StatusEnum[])
    }

    const { data, error } = await query
    if (error) return fail(`Error finding appointments by range: ${error.message}`)
    return ok((data ?? []).map(row => ({
      id: row.id,
      start_at: row.start_at,
      end_at: row.end_at,
      status: (row.status ?? 'pending') as string
    })))
  }

  async getDashboardStats(
    businessId: string,
    todayStr: string,
    monthStartStr: string
  ): Promise<Result<DashboardStats>> {
    // Check cache first
    const cached = await cache.get<DashboardStats>(
      businessId, 'dashboard', 'stats'
    )
    if (cached) return ok(cached)

    try {
      // Use the consolidated SQL RPC function — 1 query instead of 4
      const { data, error } = await this.supabase
        .rpc('fn_get_dashboard_stats', {
          p_business_id:   businessId,
          p_today_start:   todayStr,
          p_today_end:     todayStr,
          p_month_start:   monthStartStr,
        })
        .single()

      if (error) return fail(`Error fetching dashboard stats: ${error.message}`)

      const stats: DashboardStats = {
        todayCount:   Number(data?.today_count ?? 0),
        totalClients: Number(data?.total_clients ?? 0),
        monthRevenue: Number(data?.month_revenue ?? 0),
        pending:      Number(data?.pending_count ?? 0),
      }

      // Write to cache
      await cache.set(businessId, 'dashboard', 'stats', stats, TTL_SEC.DASHBOARD_STATS)

      return ok(stats)
    } catch (e) {
      return fail(toErrorMessage(e))
    }
  }
}
