/**
 * Appointments Repository — Supabase queries for appointments.
 *
 * All functions receive a Supabase client + businessId so they work
 * with both browser and server clients.
 *
 * Exposes:
 *  - getMonthAppointments:   for calendar grid
 *  - getDayAppointments:     for day panel
 *  - getDashboardStats:      aggregated counts for summary tab
 *  - updateAppointmentStatus
 *  - cancelAppointment
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { AppointmentWithRelations, SlotCheckAppointment } from '@/types'

type Client = SupabaseClient<Database>

// ── Shared select string for appointment + relations ───────────────────────
const APPOINTMENT_SELECT = `
  id, start_at, end_at, status, is_dual_booking, notes,
  client:clients(id, name, phone, avatar_url),
  service:services(id, name, color, duration_min, price),
  assigned_user:users(id, name, avatar_url, color)
` as const

/**
 * Fetches appointments for a date range (used by calendar grid).
 */
export async function getMonthAppointments(
  supabase: Client,
  businessId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<AppointmentWithRelations[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('business_id', businessId)
    .gte('start_at', `${rangeStart}T00:00:00`)
    .lte('start_at', `${rangeEnd}T23:59:59`)
    .order('start_at')

  if (error) throw new Error(`Error fetching month appointments: ${error.message}`)
  return (data as unknown as AppointmentWithRelations[]) ?? []
}

/**
 * Fetches appointments for a single day.
 */
export async function getDayAppointments(
  supabase: Client,
  businessId: string,
  dateStr: string
): Promise<AppointmentWithRelations[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('business_id', businessId)
    .gte('start_at', `${dateStr}T00:00:00`)
    .lte('start_at', `${dateStr}T23:59:59`)
    .order('start_at')

  if (error) throw new Error(`Error fetching day appointments: ${error.message}`)
  return (data as unknown as AppointmentWithRelations[]) ?? []
}

/**
 * Fetches day appointments with minimal fields for slot/double-booking checks.
 */
export async function getDaySlots(
  supabase: Client,
  businessId: string,
  startISO: string,
  endISO: string
): Promise<SlotCheckAppointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, start_at, end_at, client_id, assigned_user_id')
    .eq('business_id', businessId)
    .gte('start_at', startISO)
    .lte('start_at', endISO)
    .not('status', 'in', '("cancelled","no_show")')

  if (error) throw new Error(`Error fetching day slots: ${error.message}`)
  return (data ?? []) as SlotCheckAppointment[]
}

/**
 * Fetches a single appointment by ID for editing.
 */
export async function getAppointmentForEdit(
  supabase: Client,
  appointmentId: string,
  businessId: string
) {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, client_id, service_id, assigned_user_id, start_at, status, notes, appointment_services(service_id, sort_order)')
    .eq('id', appointmentId)
    .eq('business_id', businessId)
    .single()

  if (error) return null
  return data
}

/**
 * Updates the status of an appointment.
 */
export async function updateAppointmentStatus(
  supabase: Client,
  appointmentId: string,
  status: Database['public']['Enums']['appointment_status']
) {
  const { error } = await supabase
    .from('appointments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)

  if (error) throw new Error(`Error updating appointment status: ${error.message}`)
}

/**
 * Marks an appointment as cancelled.
 */
export async function cancelAppointment(
  supabase: Client,
  appointmentId: string
) {
  return updateAppointmentStatus(supabase, appointmentId, 'cancelled')
}

/**
 * Dashboard stats: today count, total clients, month revenue, pending.
 */
export async function getDashboardStats(
  supabase: Client,
  businessId: string,
  todayStr: string,
  monthStartStr: string
) {
  const [todayRes, clientsRes, revenueRes, pendingRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('start_at', `${todayStr}T00:00:00`)
      .lte('start_at', `${todayStr}T23:59:59`),
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .is('deleted_at', null),
    supabase
      .from('transactions')
      .select('net_amount')
      .eq('business_id', businessId)
      .gte('paid_at', `${monthStartStr}T00:00:00`),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'pending'),
  ])

  const monthRevenue = (revenueRes.data ?? []).reduce(
    (sum: number, t: { net_amount: number }) => sum + (t.net_amount ?? 0),
    0
  )

  return {
    todayCount:   todayRes.count ?? 0,
    totalClients: clientsRes.count ?? 0,
    monthRevenue,
    pending:      pendingRes.count ?? 0,
  }
}

/**
 * Creates a new appointment and returns the created ID.
 */
export async function createAppointment(
  supabase: Client,
  data: {
    business_id: string
    client_id: string
    service_ids: string[]
    assigned_user_id: string | null
    start_at: string
    end_at: string
    notes: string | null
    status: string
    is_dual_booking: boolean
  }
): Promise<{ id: string }> {
  const { service_ids, ...rest } = data
  
  const { data: row, error } = await supabase
    .from('appointments')
    .insert({
      ...rest,
      service_id: service_ids[0] ?? null,
      status: rest.status as Database['public']['Enums']['appointment_status'],
    })
    .select('id')
    .single()

  if (error || !row) throw new Error(`Error creating appointment: ${error?.message}`)

  // Insert into multi-service junction table
  if (service_ids.length > 0) {
    await supabase.from('appointment_services').insert(
      service_ids.map((sid, i) => ({
        appointment_id: row.id,
        service_id: sid,
        sort_order: i,
      }))
    )
  }

  return row
}
