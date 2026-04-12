/**
 * IServiceRepository — Domain contract for service persistence.
 *
 * Exposes: all service CRUD operations needed by the system.
 * Does not expose: Supabase, HTTP, or infrastructure details.
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { Service } from '@/types'

export type ServiceForDropdown = {
  id: string
  name: string
  duration_min: number
  price: number
}

export type CreateServicePayload = {
  name: string
  description: string | null
  duration_min: number
  price: number
  color: string | null
  category: string | null
  is_active: boolean
}

export type UpdateServicePayload = Partial<CreateServicePayload>

export interface IServiceRepository {
  /**
   * Returns all services for a business, ordered by name.
   */
  getAll(businessId: string): Promise<Result<Service[]>>

  /**
   * Returns only active services (for form dropdowns).
   */
  getActive(businessId: string): Promise<Result<ServiceForDropdown[]>>

  /**
   * Checks if a business has at least one configured service.
   */
  hasAny(businessId: string): Promise<Result<boolean>>

  /**
   * Creates a new service.
   */
  create(businessId: string, payload: CreateServicePayload): Promise<Result<void>>

  /**
   * Updates an existing service by ID.
   */
  update(
    serviceId: string,
    businessId: string,
    payload: UpdateServicePayload
  ): Promise<Result<void>>

  /**
   * Deletes a service by ID.
   */
  delete(serviceId: string, businessId: string): Promise<Result<void>>

  /**
   * Toggles the is_active flag on a service.
   */
  toggleActive(serviceId: string, currentlyActive: boolean): Promise<Result<void>>
}
