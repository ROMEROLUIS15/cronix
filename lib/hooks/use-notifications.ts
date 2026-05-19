'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

function vapidKeyToUint8Array(base64UrlKey: string): Uint8Array {
  const padding = '='.repeat((4 - (base64UrlKey.length % 4)) % 4)
  const base64  = (base64UrlKey + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = atob(base64)
  return Uint8Array.from(raw.split(''), c => c.charCodeAt(0))
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

export type NotificationState =
  | 'unsupported'
  | 'permission-denied'
  | 'idle'
  | 'subscribing'
  | 'subscribed'
  | 'unsubscribing'
  | 'denied'
  | 'missing_config'
  | 'sw_unavailable'

interface UseNotificationsReturn {
  state: NotificationState
  subscribed: boolean
  loading: boolean
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
  error: string | null
}

export function useNotifications(businessId: string | null): UseNotificationsReturn {
  const [state, setState] = useState<NotificationState>('idle')
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  // Detect existing subscription on mount
  useEffect(() => {
    if (!isPushSupported() || !businessId) {
      setState('unsupported')
      return
    }

    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setState(sub ? 'subscribed' : 'idle')
      } catch {
        setState('idle')
      }
    })()
  }, [businessId])

  const subscribe = useCallback(async () => {
    if (!isPushSupported() || !businessId || !VAPID_KEY) {
      setState('unsupported')
      return
    }

    setState('subscribing')
    setError(null)

    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState('permission-denied')
        return
      }

      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToUint8Array(VAPID_KEY) as unknown as ArrayBuffer,
      })

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setState('idle'); return }

      await supabase.from('notification_subscriptions').upsert({
        user_id: user.id,
        business_id: businessId,
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))),
      }, { onConflict: 'user_id,endpoint' })

      setState('subscribed')
    } catch (err) {
      logger.error('useNotifications', 'Subscribe failed', err)
      setError(err instanceof Error ? err.message : 'Subscription failed')
      setState('idle')
    }
  }, [businessId, supabase])

  const unsubscribe = useCallback(async () => {
    if (!businessId) return
    setState('unsubscribing')
    setError(null)

    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('notification_subscriptions')
          .delete()
          .eq('user_id', user.id)
          .eq('business_id', businessId)
      }

      setState('idle')
    } catch (err) {
      logger.error('useNotifications', 'Unsubscribe failed', err)
      setError(err instanceof Error ? err.message : 'Unsubscription failed')
      setState('subscribed')
    }
  }, [businessId, supabase])

  // Auto re-subscribe when the browser rotates the push subscription.
  // The SW posts PUSH_SUBSCRIPTION_EXPIRED on `pushsubscriptionchange`.
  // Without this, push silently stops working ~30 days after install on Android.
  const subscribeRef = useRef(subscribe)
  useEffect(() => { subscribeRef.current = subscribe }, [subscribe])

  useEffect(() => {
    if (!isPushSupported() || !businessId) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_EXPIRED') {
        logger.info('useNotifications', 'Push subscription expired, re-subscribing')
        void subscribeRef.current()
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [businessId])

  return {
    state,
    subscribed: state === 'subscribed',
    loading: state === 'subscribing' || state === 'unsubscribing',
    subscribe,
    unsubscribe,
    error,
  }
}
