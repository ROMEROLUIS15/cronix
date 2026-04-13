/**
 * IUserRepository — Domain contract for user and team management.
 */

import { Result } from '@/types/result'
import { Database } from '@/types/database.types'

export interface BusinessContext {
  userId: string
  businessId: string
  userName: string
  userRole: Database['public']['Enums']['user_role'] | null
}

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

export interface CreateEmployeePayload {
  name: string
  email: string | null
  phone: string | null
  color: string | null
}

/** Partial payload for employee updates — only provided fields are updated. */
export type UpdateEmployeePayload = Partial<Omit<CreateEmployeePayload, 'email'> & { email: string | null }>

export interface IUserRepository {
  /**
   * Resolves the authenticated user's business context.
   */
  getBusinessContext(): Promise<Result<BusinessContext | null>>

  /**
   * Returns the full user profile row.
   */
  getUserProfile(userId: string): Promise<Result<{
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
  } | null>>

  /**
   * Returns all team members for a business.
   */
  getTeamMembers(businessId: string): Promise<Result<TeamMember[]>>

  /**
   * Creates a new operational employee profile.
   */
  createEmployee(businessId: string, payload: CreateEmployeePayload): Promise<Result<TeamMember>>

  /**
   * Updates an employee profile.
   */
  updateEmployee(employeeId: string, businessId: string, payload: UpdateEmployeePayload): Promise<Result<void>>

  /**
   * Toggles active status.
   */
  toggleEmployeeActive(employeeId: string, businessId: string, currentlyActive: boolean): Promise<Result<void>>

  /**
   * Deletes an employee.
   */
  deleteEmployee(employeeId: string, businessId: string): Promise<Result<void>>

  /**
   * Returns active staff for tool assignment.
   */
  findActiveStaff(businessId: string): Promise<Result<{ id: string; name: string; role: string }[]>>

  /**
   * Updates the authenticated user's own profile fields (name, phone).
   */
  updateProfile(userId: string, payload: { name: string; phone: string | null }): Promise<Result<void>>

  /**
   * Updates the authenticated user's avatar URL.
   */
  updateAvatar(userId: string, avatarUrl: string | null): Promise<Result<void>>
}
