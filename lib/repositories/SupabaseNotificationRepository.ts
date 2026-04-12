/**
 * SupabaseNotificationRepository — Concrete implementation of INotificationRepository.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail } from '@/types/result'
import {
  INotificationRepository,
  CreateNotificationPayload
} from '@/lib/domain/repositories/INotificationRepository'
import type { InAppNotification } from '@/components/layout/notification-panel'

type Client = SupabaseClient<Database>

export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(private supabase: Client) {}

  async create(payload: CreateNotificationPayload): Promise<Result<InAppNotification | null>> {
    const { data, error } = await this.supabase
      .from('notifications')
      .insert([
        {
          business_id: payload.business_id,
          user_id: payload.user_id,
          title: payload.title,
          content: payload.content,
          type: payload.type,
          // Cast metadata to satisfy Supabase's Json type (Record<string,unknown> is a valid Json object)
          metadata: (payload.metadata ?? {}) as unknown as import('@/types/database.types').Json,
          is_read: false,
        },
      ])
      .select()
      .single()

    if (error) return fail(`Failed to create notification: ${error.message}`)
    return ok((data as unknown as InAppNotification) || null)
  }

  async getAll(businessId: string, limit = 50): Promise<Result<InAppNotification[]>> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return fail(`Failed to fetch notifications: ${error.message}`)
    return ok((data as unknown as InAppNotification[]) || [])
  }

  async markAsRead(notificationId: string, businessId: string): Promise<Result<void>> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('business_id', businessId)

    if (error) return fail(`Failed to mark notification as read: ${error.message}`)
    return ok(undefined)
  }

  async deleteOld(businessId: string, daysOld = 30): Promise<Result<number>> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)

    const { data, error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('business_id', businessId)
      .lt('created_at', cutoffDate.toISOString())
      .select('id')

    if (error) return fail(`Failed to delete old notifications: ${error.message}`)
    return ok(data?.length ?? 0)
  }
}
