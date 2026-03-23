/**
 * Users Repository — Supabase queries for user/auth context.
 *
 * Centralizes the `getUser() → select business_id` pattern
 * that is currently duplicated in 8+ pages.
 *
 * Exposes:
 *  - getBusinessContext:  auth user → { userId, businessId, userName }
 *  - getUserProfile:      full user row
 *  - getBusinessMembers:  all active users in a business
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Client = SupabaseClient<Database>

export interface BusinessContext {
  userId: string
  businessId: string
  userName: string
  userRole: Database['public']['Enums']['user_role'] | null
}

/**
 * Resolves the authenticated user's business context.
 * Returns null if user is not authenticated or has no business.
 */
export async function getBusinessContext(
  supabase: Client
): Promise<BusinessContext | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: dbUser } = await supabase
    .from('users')
    .select('business_id, name, role')
    .eq('id', user.id)
    .single()

  if (!dbUser?.business_id) return null

  return {
    userId: user.id,
    businessId: dbUser.business_id,
    userName: dbUser.name?.split(' ')[0] ?? 'Usuario',
    userRole: dbUser.role,
  }
}

/**
 * Returns the full user profile row.
 */
export async function getUserProfile(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, phone, avatar_url, color, role, business_id, status, provider')
    .eq('id', userId)
    .single()

  if (error) throw new Error(`Error fetching user profile: ${error.message}`)
  return data
}

/**
 * Returns all active users (employees) for a business.
 */
export async function getBusinessMembers(
  supabase: Client,
  businessId: string
) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, avatar_url, color, role, is_active')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(`Error fetching business members: ${error.message}`)
  return data ?? []
}

/**
 * Returns only the business_id for a given user.
 * Lightweight check used by setup flow to verify if user already has a business.
 */
export async function getUserBusinessId(
  supabase: Client,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('business_id')
    .eq('id', userId)
    .single()

  return data?.business_id ?? null
}

/**
 * Upserts a user row (insert or update on conflict with `id`).
 * Used during onboarding to link a user to their newly created business.
 */
export async function upsertUser(
  supabase: Client,
  data: {
    id: string
    name: string
    email: string
    business_id: string
    role: Database['public']['Enums']['user_role']
  }
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .upsert(data, { onConflict: 'id' })

  if (error) throw new Error(`Error upserting user: ${error.message}`)
}

/**
 * Updates a user's profile fields.
 * Only updates the fields provided — partial update.
 */
export async function updateUser(
  supabase: Client,
  userId: string,
  data: Partial<Pick<Database['public']['Tables']['users']['Update'], 'name' | 'phone' | 'avatar_url'>>
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update(data)
    .eq('id', userId)

  if (error) throw new Error(`Error updating user: ${error.message}`)
}

// ── Employee Management ─────────────────────────────────────────────────────

/** Shape returned by employee list queries. */
export interface TeamMember {
  id: string
  name: string
  email: string | null
  phone: string | null
  avatar_url: string | null
  color: string | null
  role: Database['public']['Enums']['user_role'] | null
  is_active: boolean | null
  created_at: string | null
}

const TEAM_MEMBER_SELECT = 'id, name, email, phone, avatar_url, color, role, is_active, created_at' as const

/**
 * Returns all team members for a business (owner + employees), ordered by role then name.
 */
export async function getTeamMembers(
  supabase: Client,
  businessId: string
): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('users')
    .select(TEAM_MEMBER_SELECT)
    .eq('business_id', businessId)
    .order('role')
    .order('name')

  if (error) throw new Error(`Error fetching team members: ${error.message}`)
  return (data ?? []) as TeamMember[]
}

/** Payload for creating a new employee. */
export interface CreateEmployeePayload {
  name: string
  email: string | null
  phone: string | null
  color: string | null
}

/**
 * Creates a new employee linked to a business.
 * The employee is NOT an auth user — just an operational profile for appointment assignment.
 */
export async function createEmployee(
  supabase: Client,
  businessId: string,
  payload: CreateEmployeePayload
): Promise<TeamMember> {
  const { data, error } = await supabase
    .from('users')
    .insert({
      ...payload,
      business_id: businessId,
      role: 'employee',
      is_active: true,
      status: 'active',
    })
    .select(TEAM_MEMBER_SELECT)
    .single()

  if (error) throw new Error(`Error creating employee: ${error.message}`)
  return data as TeamMember
}

/** Payload for updating an existing employee. */
export interface UpdateEmployeePayload {
  name?: string
  email?: string | null
  phone?: string | null
  color?: string | null
}

/**
 * Updates an employee's profile. Business ID is checked for isolation.
 */
export async function updateEmployee(
  supabase: Client,
  employeeId: string,
  businessId: string,
  payload: UpdateEmployeePayload
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', employeeId)
    .eq('business_id', businessId)
    .eq('role', 'employee')

  if (error) throw new Error(`Error updating employee: ${error.message}`)
}

/**
 * Toggles an employee's is_active flag (soft enable/disable).
 */
export async function toggleEmployeeActive(
  supabase: Client,
  employeeId: string,
  businessId: string,
  currentlyActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ is_active: !currentlyActive })
    .eq('id', employeeId)
    .eq('business_id', businessId)
    .eq('role', 'employee')

  if (error) throw new Error(`Error toggling employee status: ${error.message}`)
}

/**
 * Permanently deletes an employee profile.
 * Only allowed if the employee has no assigned appointments.
 */
export async function deleteEmployee(
  supabase: Client,
  employeeId: string,
  businessId: string
): Promise<void> {
  // Check for assigned appointments before deleting
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_user_id', employeeId)
    .eq('business_id', businessId)

  if (count && count > 0) {
    throw new Error(
      `No se puede eliminar: este empleado tiene ${count} cita(s) asignada(s). Desactívalo en su lugar.`
    )
  }

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', employeeId)
    .eq('business_id', businessId)
    .eq('role', 'employee')

  if (error) throw new Error(`Error deleting employee: ${error.message}`)
}
