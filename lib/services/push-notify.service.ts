/**
 * push-notify.service.ts — Client-side helper to send Web Push notifications.
 *
 * Calls the `push-notify` Supabase Edge Function using supabase.functions.invoke(),
 * which automatically adds the user's JWT to the Authorization header.
 * The Edge Function resolves the business_id from the JWT, so we only need
 * to pass the notification content.
 *
 * Non-blocking by design: errors are logged but never thrown, so a push
 * failure never prevents the user from completing their action (e.g. booking).
 */

import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

export interface PushNotifyParams {
  title: string
  body:  string
  url?:  string
}

/**
 * Sends a Web Push notification to all devices of the current user's business.
 * Fire-and-forget — safe to call without await, or with .catch(() => null).
 */
export async function notifyOwner(params: PushNotifyParams): Promise<void> {
  try {
    const supabase = createClient()
    const { error } = await supabase.functions.invoke('push-notify', {
      body: params,
    })
    if (error) {
      logger.warn('push-notify', 'invoke error', error.message)
    }
  } catch (err) {
    logger.warn('push-notify', 'unexpected error', err)
  }
}
