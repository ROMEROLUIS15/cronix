'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InAppNotification } from '@/components/layout/notification-panel'

export function useInAppNotifications(businessId: string | null) {
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchNotifications = useCallback(async () => {
    if (!businessId) return
    
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!error && data) {
      setNotifications(data as InAppNotification[])
    }
    setLoading(false)
  }, [businessId, supabase])

  const markAllAsRead = useCallback(async () => {
    if (!businessId) return
    
    // Optimistic UI update
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))

    // Server update
    const { error } = await supabase.rpc('fn_mark_all_notifications_as_read', {
      target_business_id: businessId
    })

    if (error) {
      console.error('Error marking all as read:', error)
      fetchNotifications() // rollback
    }
  }, [businessId, supabase, fetchNotifications])

  useEffect(() => {
    if (!businessId) return

    fetchNotifications()

    // Real-time subscription
    const channel = supabase
      .channel(`business-notifications-${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          fetchNotifications()
          // Optional: Add a subtle sound or toast for new notifications
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [businessId, fetchNotifications, supabase])

  return {
    notifications,
    loading,
    unreadCount: notifications.filter(n => !n.is_read).length,
    markAllAsRead,
    refresh: fetchNotifications
  }
}
