'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InAppNotification } from '@/components/layout/notification-panel'

export function useInAppNotifications(businessId: string | null) {
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [loading, setLoading] = useState(true)

  // The previous `const supabase = createClient()` ran on every render and
  // because `supabase` was a dependency of the subscribe effect below the
  // realtime channel was being torn down and re-subscribed on every state
  // change. useMemo gives us one client for the lifetime of the hook.
  const supabase = useMemo(() => createClient(), [])

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

    // Defer the initial fetch until the browser is idle. The dashboard's
    // critical-render-path (calendar, stats) doesn't depend on the bell badge,
    // so we hand the CPU back so React can hydrate and paint first.
    // Falls back to setTimeout(0) on Safari (no requestIdleCallback).
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?:  (id: number) => void
    })
    const fire = () => { void fetchNotifications() }
    const handle = ric.requestIdleCallback
      ? ric.requestIdleCallback(fire, { timeout: 2000 })
      : (window.setTimeout(fire, 0) as unknown as number)

    // Real-time subscription (postgres_changes)
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
        }
      )
      .subscribe()

    // Broadcast bridge: the dashboard realtime hook dispatches this window event when
    // a broadcast arrives from the WhatsApp/voice edge functions (RLS-independent path),
    // so the bell refreshes live even if postgres_changes is dropped for cross-channel writes.
    const onRealtimeRefresh = () => { void fetchNotifications() }
    window.addEventListener('cronix:realtime-refresh', onRealtimeRefresh)

    // Safety net so the bell never needs a manual reload: poll every 20s while the tab
    // is visible, even if realtime delivery is dropped. Broadcast/postgres_changes make
    // it instant when they work.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchNotifications()
    }, 20_000)

    return () => {
      if (ric.cancelIdleCallback && ric.requestIdleCallback) ric.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
      supabase.removeChannel(channel)
      window.removeEventListener('cronix:realtime-refresh', onRealtimeRefresh)
      window.clearInterval(poll)
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
