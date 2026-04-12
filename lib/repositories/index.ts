/**
 * Repository Factory — barrel export.
 *
 * Usage (Server Actions, API Routes, Hooks):
 *  const { appointments, clients } = getRepos(supabase)
 *  const result = await appointments.getAll(businessId)
 *  if (result.error) return showMsg('error', result.error)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'

import { SupabaseAppointmentRepository } from './SupabaseAppointmentRepository'
import { SupabaseUserRepository } from './SupabaseUserRepository'
import { SupabaseClientRepository } from './SupabaseClientRepository'
import { SupabaseFinanceRepository } from './SupabaseFinanceRepository'
import { SupabaseServiceRepository } from './SupabaseServiceRepository'
import { SupabaseBusinessRepository } from './SupabaseBusinessRepository'
import { SupabaseNotificationRepository } from './SupabaseNotificationRepository'
import { SupabaseReminderRepository } from './SupabaseReminderRepository'

type TypedSupabaseClient = SupabaseClient<Database>

/**
 * Repository Factory — Returns typed repository instances.
 * Finance repo is injected into appointment repo for getDashboardStats.
 *
 * SECURITY: Accepts only a typed SupabaseClient<Database> to prevent
 * misconfigured clients from bypassing RLS or querying wrong tables.
 */
export const getRepos = (supabase: TypedSupabaseClient) => {
  const finances = new SupabaseFinanceRepository(supabase)

  return {
    appointments:  new SupabaseAppointmentRepository(supabase, finances),
    users:         new SupabaseUserRepository(supabase),
    clients:       new SupabaseClientRepository(supabase),
    finances,
    services:      new SupabaseServiceRepository(supabase),
    businesses:    new SupabaseBusinessRepository(supabase),
    notifications: new SupabaseNotificationRepository(supabase),
    reminders:     new SupabaseReminderRepository(supabase),
  }
}
