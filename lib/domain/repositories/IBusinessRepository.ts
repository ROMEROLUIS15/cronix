/**
 * IBusinessRepository — Domain contract for business persistence.
 */

import type { Result } from '@/types/result'
import { Database } from '@/types/database.types'

type BusinessInsert = Database['public']['Tables']['businesses']['Insert']
type BusinessRow = Database['public']['Tables']['businesses']['Row']

/**
 * Parameters for atomically creating a business and linking its owner.
 * Contains no Supabase or infrastructure references — future backends
 * implement this via a transactional HTTP endpoint or equivalent.
 */
export interface CreateBusinessWithOwnerParams {
  ownerId:    string
  ownerName:  string
  ownerEmail: string
  name:       string
  category:   string
  timezone:   string
  plan:       string
}

export interface IBusinessRepository {
  /**
   * Returns the settings JSON for a business.
   */
  getSettings(businessId: string): Promise<Result<{ settings: Record<string, unknown> | null }>>

  /**
   * Creates a new business and returns the created row.
   */
  create(data: Pick<BusinessInsert, 'name' | 'category' | 'owner_id' | 'plan'> & { timezone?: string }): Promise<Result<BusinessRow>>

  /**
   * Returns a business by its ID.
   */
  getById(businessId: string): Promise<Result<BusinessRow>>

  /**
   * Returns just the business name.
   */
  getName(businessId: string): Promise<Result<string | null>>

  /**
   * Updates business profile fields.
   */
  update(businessId: string, data: Partial<BusinessRow>): Promise<Result<void>>

  /**
   * Updates business settings JSON.
   */
  updateSettings(businessId: string, settings: Record<string, unknown>): Promise<Result<void>>

  /**
   * Atomically creates a business AND links the owner user in one transaction.
   * Prevents the orphaned-business state that occurs when the two-step pattern
   * (create → link) fails between steps.
   */
  createWithOwnerLink(params: CreateBusinessWithOwnerParams): Promise<Result<BusinessRow>>
}
