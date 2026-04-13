import { sendWebPush } from './vapid.ts'
import type { PushSubscription, PushPayload } from './vapid.ts'
import type { NotificationSubscription } from './modules/subscription-manager.ts'

export interface PushResult {
  sent: number
  failed: number
  expiredEndpoints: string[]
}

export async function fanOutPush(
  subs: NotificationSubscription[],
  payload: PushPayload,
  vapidPubKey: string,
  vapidPrivKey: string,
  vapidSubject: string
): Promise<PushResult> {
  const results = await Promise.allSettled(
    (subs as PushSubscription[]).map(sub =>
      sendWebPush(sub, payload, vapidPubKey, vapidPrivKey, vapidSubject)
    )
  )

  let sent = 0
  let failed = 0
  const expiredEndpoints: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled' && result.value.ok) {
      sent++
    } else {
      failed++
      const sub = (subs as PushSubscription[])[i]!
      if (result.status === 'fulfilled' && (result.value.status === 410 || result.value.status === 404)) {
        expiredEndpoints.push(sub.endpoint)
      }
    }
  }

  return { sent, failed, expiredEndpoints }
}
