'use client'

/**
 * useNotifications — Web Push subscription lifecycle manager.
 *
 * Handles:
 *  - Feature detection (Push API + Notification API + ServiceWorker)
 *  - Requesting notification permission
 *  - Subscribing / unsubscribing via the browser PushManager
 *  - Persisting the PushSubscription in `notification_subscriptions` (Supabase)
 *  - Detecting existing subscription on mount
 *
 * Multi-tenant safe:
 *  - Subscription is always scoped to the current user_id + business_id
 *  - Unsubscribing removes the row from the DB too
 *
 * Required env var (Vercel):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — base64url VAPID public key
 *                                   (generate with: npx web-push generate-vapid-keys)
 *
 * Usage:
 *   const { state, subscribed, loading, subscribe, unsubscribe } =
 *     useNotifications(businessId)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a base64url VAPID public key to a Uint8Array for PushManager.subscribe.
 * The browser requires an ArrayBuffer / Uint8Array, not a raw string.
 */
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

/**
 * Resolves when a ServiceWorker becomes active, or rejects after `ms` milliseconds.
 * Prevents infinite hangs if the SW fails to register (build issues, browser quirks).
 */
function getReadyRegistration(ms = 8_000): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('SW_NOT_READY')), ms)
  )
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * - unsupported   : browser lacks Push/Notification/ServiceWorker API
 * - default       : permission not yet requested
 * - granted       : permission granted
 * - denied        : user blocked notifications (must unlock in browser settings)
 * - missing_config: NEXT_PUBLIC_VAPID_PUBLIC_KEY env var not set
 * - sw_unavailable: ServiceWorker not registered (disabled in dev, or build issue)
 */
export type NotificationPermission =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied'
  | 'missing_config'
  | 'sw_unavailable'

export interface UseNotificationsReturn {
  /** Current permission state — 'unsupported' if the browser lacks Push API. */
  state:       NotificationPermission
  /** Whether a valid subscription exists in the DB for this user+business. */
  subscribed:  boolean
  /** True while subscribe/unsubscribe is in progress. */
  loading:     boolean
  /** Request permission, subscribe via PushManager, persist to DB. */
  subscribe:   () => Promise<void>
  /** Unsubscribe from browser PushManager and remove from DB. */
  unsubscribe: () => Promise<void>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNotifications(businessId: string | null): UseNotificationsReturn {
  const supabase = useMemo(() => createClient(), [])

  const [state,      setState]      = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading,    setLoading]    = useState(false)

  // ── Feature detection + initial permission state ──────────────────────
  useEffect(() => {
    if (!isPushSupported()) {
      setState('unsupported')
      return
    }
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidPublicKey) {
      setState('missing_config')
      return
    }
    setState(window.Notification.permission as NotificationPermission)
  }, [])

  // ── Check if an active subscription already exists in the DB ─────────
  useEffect(() => {
    if (state !== 'granted' || !businessId) return

    async function checkExisting() {
      try {
        const reg      = await getReadyRegistration()
        const existing = await reg.pushManager.getSubscription()
        if (!existing) { setSubscribed(false); return }

        const { data } = await supabase
          .from('notification_subscriptions')
          .select('id')
          .eq('endpoint', existing.endpoint)
          .maybeSingle()

        setSubscribed(!!data)
      } catch {
        setSubscribed(false)
      }
    }

    checkExisting()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, businessId])

  // ── Subscribe ─────────────────────────────────────────────────────────
  const subscribe = useCallback(async () => {
    if (!businessId) return
    setLoading(true)

    try {
      // 1. Request browser permission
      const perm = await window.Notification.requestPermission()
      setState(perm as NotificationPermission)
      if (perm !== 'granted') return

      // 2. Wait for SW registration (8 s timeout — fails gracefully in dev/no-SW envs)
      let reg: ServiceWorkerRegistration
      try {
        reg = await getReadyRegistration()
      } catch {
        setState('sw_unavailable')
        return
      }

      // 3. Subscribe via PushManager
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        setState('missing_config')
        logger.error('useNotifications', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set')
        return
      }

      const pushSub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: vapidKeyToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      })

      // 4. Serialize the subscription
      const subJson = pushSub.toJSON() as {
        endpoint: string
        keys:     { p256dh: string; auth: string }
      }

      // 5. Identify the current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // 6. Persist to notification_subscriptions with upsert
      //    (handles browser refresh → same endpoint, different keys)
      const { error } = await supabase.from('notification_subscriptions').upsert(
        {
          user_id:     user.id,
          business_id: businessId,
          endpoint:    subJson.endpoint,
          p256dh:      subJson.keys.p256dh,
          auth:        subJson.keys.auth,
          user_agent:  navigator.userAgent.slice(0, 200),
          updated_at:  new Date().toISOString(),
        },
        { onConflict: 'user_id,endpoint' },
      )

      if (error) {
        logger.error('useNotifications', 'DB upsert error', error)
        return
      }

      setSubscribed(true)
    } catch (err) {
      logger.error('useNotifications', 'subscribe failed', err)
    } finally {
      setLoading(false)
    }
  }, [businessId, supabase])

  // ── Unsubscribe ───────────────────────────────────────────────────────
  const unsubscribe = useCallback(async () => {
    setLoading(true)
    try {
      const reg = await getReadyRegistration()
      const sub = await reg.pushManager.getSubscription()

      if (sub) {
        // Remove from browser
        await sub.unsubscribe()

        // Remove from DB
        await supabase.from('notification_subscriptions')
          .delete()
          .eq('endpoint', sub.endpoint)
      }

      setSubscribed(false)
    } catch (err) {
      logger.error('useNotifications', 'unsubscribe failed', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  return { state, subscribed, loading, subscribe, unsubscribe }
}
