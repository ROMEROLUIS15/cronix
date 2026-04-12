/**
 * IBusinessRepository — Domain contract for business persistence.
 */

import type { Result } from '@/types/result'
import { Database } from '@/types/database.types'

type BusinessInsert = Database['public']['Tables']['businesses']['Insert']
type BusinessRow = Database['public']['Tables']['businesses']['Row']

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
}
