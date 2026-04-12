/**
 * INotificationRepository — Domain contract for in-app notification persistence.
 *
 * Exposes: notification create/read/update/delete operations.
 * Does not expose: Supabase, HTTP, or infrastructure details.
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { InAppNotification } from '@/components/layout/notification-panel'

export type CreateNotificationPayload = {
  business_id: string
  user_id?: string | null
  title: string
  content: string
  type: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}

export interface INotificationRepository {
  /**
   * Creates a notification and returns the created row.
   */
  create(payload: CreateNotificationPayload): Promise<Result<InAppNotification | null>>

  /**
   * Returns recent notifications for a business.
   */
  getAll(businessId: string, limit?: number): Promise<Result<InAppNotification[]>>

  /**
   * Marks a single notification as read.
   */
  markAsRead(notificationId: string, businessId: string): Promise<Result<void>>

  /**
   * Deletes notifications older than N days. Returns count deleted.
   */
  deleteOld(businessId: string, daysOld?: number): Promise<Result<number>>
}
