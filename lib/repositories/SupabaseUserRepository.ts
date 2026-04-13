/**
 * SupabaseUserRepository — Concrete implementation of IUserRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail, toErrorMessage } from '@/types/result'
import {
  IUserRepository,
  BusinessContext,
  TeamMember,
  CreateEmployeePayload,
  UpdateEmployeePayload,
} from '@/lib/domain/repositories/IUserRepository'

type Client = SupabaseClient<Database>

const TEAM_MEMBER_SELECT = 'id, name, email, phone, avatar_url, color, role, is_active, created_at' as const

export class SupabaseUserRepository implements IUserRepository {
  constructor(private supabase: Client) {}

  async getBusinessContext(): Promise<Result<BusinessContext | null>> {
    try {
      const { data: { user } } = await this.supabase.auth.getUser()
      if (!user) return ok(null)

      const { data: dbUser, error } = await this.supabase
        .from('users')
        .select('business_id, name, role')
        .eq('id', user.id)
        .single()

      if (error || !dbUser?.business_id) return ok(null)

      return ok({
        userId: user.id,
        businessId: dbUser.business_id,
        userName: dbUser.name?.split(' ')[0] ?? 'Usuario',
        userRole: dbUser.role as Database['public']['Enums']['user_role'] | null,
      })
    } catch (e) {
      return fail(toErrorMessage(e))
    }
  }

  async getUserProfile(userId: string): Promise<Result<{
    id: string
    name: string | null
    email: string | null
    phone: string | null
    avatar_url: string | null
    color: string | null
    role: Database['public']['Enums']['user_role'] | null
    business_id: string | null
    status: string | null
    provider: Database['public']['Enums']['auth_provider'] | null
  } | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, name, email, phone, avatar_url, color, role, business_id, status, provider')
      .eq('id', userId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return ok(null)
      return fail(`Error fetching user profile: ${error.message}`)
    }
    return ok(data)
  }

  async getTeamMembers(businessId: string): Promise<Result<TeamMember[]>> {
    const { data, error } = await this.supabase
      .from('users')
      .select(TEAM_MEMBER_SELECT)
      .eq('business_id', businessId)
      .order('role')
      .order('name')

    if (error) return fail(`Error fetching team members: ${error.message}`)
    return ok((data ?? []) as TeamMember[])
  }

  async createEmployee(
    businessId: string,
    payload: CreateEmployeePayload
  ): Promise<Result<TeamMember>> {
    const { data, error } = await this.supabase
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

    if (error) return fail(`Error creating employee: ${error.message}`)
    return ok(data as TeamMember)
  }

  async updateEmployee(
    employeeId: string,
    businessId: string,
    payload: UpdateEmployeePayload
  ): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('users')
      .update(payload)
      .eq('id', employeeId)
      .eq('business_id', businessId)
      .eq('role', 'employee')

    if (error) return fail(`Error updating employee: ${error.message}`)
    return ok(undefined)
  }

  async toggleEmployeeActive(
    employeeId: string,
    businessId: string,
    currentlyActive: boolean
  ): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('users')
      .update({ is_active: !currentlyActive })
      .eq('id', employeeId)
      .eq('business_id', businessId)
      .eq('role', 'employee')

    if (error) return fail(`Error toggling employee status: ${error.message}`)
    return ok(undefined)
  }

  async deleteEmployee(
    employeeId: string,
    businessId: string
  ): Promise<Result<void>> {
    try {
      const { count, error: cError } = await this.supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_user_id', employeeId)
        .eq('business_id', businessId)

      if (cError) return fail(cError.message)
      if (count && count > 0) {
        return fail(`No se puede eliminar: este empleado tiene ${count} cita(s) asignada(s). Desactívalo en su lugar.`)
      }

      const { error } = await this.supabase
        .from('users')
        .delete()
        .eq('id', employeeId)
        .eq('business_id', businessId)
        .eq('role', 'employee')

      if (error) return fail(`Error deleting employee: ${error.message}`)
      return ok(undefined)
    } catch (e) {
      return fail(toErrorMessage(e))
    }
  }

  async findActiveStaff(businessId: string): Promise<Result<{ id: string; name: string; role: string }[]>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, name, role')
      .eq('business_id', businessId)
      .in('role', ['owner', 'employee'])
      .eq('is_active', true)

    if (error) return fail(`Error finding active staff: ${error.message}`)
    return ok((data ?? []).map(row => ({
      id: row.id,
      name: row.name ?? '',
      role: (row.role ?? 'employee') as string
    })))
  }

  async updateProfile(
    userId: string,
    payload: { name: string; phone: string | null }
  ): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('users')
      .update({ name: payload.name, phone: payload.phone })
      .eq('id', userId)

    if (error) return fail(`Error updating profile: ${error.message}`)
    return ok(undefined)
  }

  async updateAvatar(userId: string, avatarUrl: string | null): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId)

    if (error) return fail(`Error updating avatar: ${error.message}`)
    return ok(undefined)
  }

  async getUserContextById(userId: string): Promise<Result<{
    role: string | null
    business_id: string | null
    name: string | null
    provider: string | null
  } | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('role, business_id, name, provider')
      .eq('id', userId)
      .maybeSingle()

    if (error) return fail(`Error fetching user context: ${error.message}`)
    if (!data) return ok(null)
    return ok({
      role: data.role ?? null,
      business_id: data.business_id ?? null,
      name: data.name ?? null,
      provider: data.provider ?? null,
    })
  }

  async getUserProfileByEmail(email: string): Promise<Result<{
    id: string
    provider: string | null
  } | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, provider')
      .eq('email', email)
      .maybeSingle()

    if (error) return fail(`Error finding user by email: ${error.message}`)
    if (!data) return ok(null)
    return ok({
      id: data.id,
      provider: data.provider ?? null,
    })
  }

  async linkUserToBusiness(userId: string, payload: {
    name: string
    business_id: string
    role: string
    status: string
  }): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('users')
      .update({
        name: payload.name,
        business_id: payload.business_id,
        role: payload.role as Database['public']['Enums']['user_role'],
        status: payload.status as Database['public']['Enums']['user_status'],
      })
      .eq('id', userId)

    if (error) return fail(`Error linking user to business: ${error.message}`)
    return ok(undefined)
  }
}
