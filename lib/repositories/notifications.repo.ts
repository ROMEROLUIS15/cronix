/**
 * Notifications Repository — Supabase queries for in-app notifications.
 *
 * Handles:
 *  - Creating notifications
 *  - Fetching notifications for a business
 *  - Marking notifications as read (single/all)
 *
 * All functions receive a Supabase client + businessId for multi-tenant safety.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { InAppNotification } from '@/components/layout/notification-panel'

type Client = SupabaseClient<Database>

// ── Create Notification ────────────────────────────────────────────────────

export interface CreateNotificationInput {
  business_id: string
  user_id?: string | null
  title: string
  content: string
  type: 'info' | 'success' | 'warning' | 'error'
  metadata?: Record<string, unknown>
}

export async function createNotification(
  supabase: Client,
  input: CreateNotificationInput
): Promise<InAppNotification | null> {
  const { data, error } = await supabase
    .from('notifications')
    .insert([
      {
        business_id: input.business_id,
        user_id: input.user_id,
        title: input.title,
        content: input.content,
        type: input.type,
        metadata: input.metadata || {},
        is_read: false,
      },
    ])
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create notification: ${error.message}`)
  }

  return (data as unknown as InAppNotification) || null
}

// ── Get Notifications ──────────────────────────────────────────────────────

export async function getNotifications(
  supabase: Client,
  businessId: string,
  limit = 50
): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to fetch notifications: ${error.message}`)
  }

  return (data as unknown as InAppNotification[]) || []
}

// ── Mark as Read ───────────────────────────────────────────────────────────

export async function markNotificationAsRead(
  supabase: Client,
  notificationId: string,
  businessId: string
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('business_id', businessId)

  if (error) {
    throw new Error(`Failed to mark notification as read: ${error.message}`)
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────

export async function deleteOldNotifications(
  supabase: Client,
  businessId: string,
  daysOld = 30
): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  const { data, error } = await supabase
    .from('notifications')
    .delete()
    .eq('business_id', businessId)
    .lt('created_at', cutoffDate.toISOString())
    .select('id')

  if (error) {
    throw new Error(`Failed to delete old notifications: ${error.message}`)
  }

  return data?.length ?? 0
}
