/**
 * notif-channels.ts — The side-effect channels for an AppointmentEvent.
 *
 * DB persistence (source of truth + idempotency), Realtime broadcast, owner WhatsApp
 * (template-first, free-text fallback) and owner web push. Each fails silently — the
 * booking is already committed, so notifications are best-effort.
 */

import { supabase } from "./db-client.ts"
import { formatLocalTime } from "./prompt-builder.ts"
import {
  type AppointmentEvent,
  buildTitle, buildContent, buildOwnerWhatsAppMessage, formatDateHuman,
} from "./notif-contracts.ts"

/** Idempotency: true when this eventId already has a notification row. */
export async function checkEventExists(eventId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('notifications').select('id').eq('event_id', eventId).maybeSingle()
    if (error) return false  // falla segura: tratar como no procesado
    return data !== null
  } catch {
    return false
  }
}

/** Persists the notification row (source of truth). Returns false on any failure. */
export async function saveNotificationToDB(event: AppointmentEvent): Promise<boolean> {
  try {
    const { error } = await supabase.from('notifications').insert({
      business_id: event.businessId,
      title:       buildTitle(event.type),
      content:     buildContent(event),
      type:        event.type === 'appointment.cancelled' ? 'warning' : 'success',
      is_read:     false,
      event_id:    event.eventId,
      metadata: {
        eventType:   event.type,
        clientName:  event.clientName,
        serviceName: event.serviceName,
        date:        event.date,
        time:        event.time,
        channel:     event.channel,
        userId:      event.userId,
      },
    })
    if (error) {
      console.error('[NOTIFICATION-WA] saveNotificationToDB failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[NOTIFICATION-WA] saveNotificationToDB threw:', err)
    return false
  }
}

/** Realtime broadcast to the dashboard bell (RLS-independent). Non-critical. */
export async function pushToRealtime(event: AppointmentEvent): Promise<void> {
  try {
    const channel = supabase.channel(`notifications:${event.businessId}`)
    await channel.send({
      type:    'broadcast',
      event:   event.type,
      payload: {
        eventId:     event.eventId,
        title:       buildTitle(event.type),
        content:     buildContent(event),
        clientName:  event.clientName,
        serviceName: event.serviceName,
        date:        event.date,
        time:        event.time,
      },
    })
    await supabase.removeChannel(channel)
  } catch (err) {
    console.warn('[NOTIFICATION-WA] pushToRealtime failed (non-critical):', err)
  }
}

// Approved Meta template for per-event owner alerts. Configurable via secret so an
// already-approved template can be wired without a redeploy; it MUST have exactly 4 body
// variables in order: {{1}} estado, {{2}} cliente, {{3}} servicio, {{4}} fecha y hora.
// If the template isn't approved, the free-text fallback takes over.
// @ts-ignore — Deno runtime globals
const OWNER_EVENT_TEMPLATE = Deno.env.get('OWNER_EVENT_TEMPLATE') ?? 'owner_event_notification'

/**
 * Owner WhatsApp via the whatsapp-service edge function (single WA transport point).
 * Template first — it delivers OUTSIDE the 24h window, the whole point of per-event
 * alerts; free-text fallback works while the owner's 24h window is open. Best-effort.
 */
export async function sendOwnerWhatsApp(event: AppointmentEvent): Promise<void> {
  try {
    // @ts-ignore — Deno runtime globals
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-ignore
    const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''

    // Owner's verified WhatsApp is stored in businesses.phone (set via VINCULAR-slug).
    const { data: bData } = await supabase
      .from('businesses').select('phone').eq('id', event.businessId).maybeSingle()

    const rawPhone = (bData as { phone?: string | null })?.phone
    if (!rawPhone) {
      console.warn('[NOTIFICATION-WA] No owner phone found for business, skipping WA notification', event.businessId)
      return
    }
    if (!supabaseUrl || !cronSecret) {
      console.warn('[NOTIFICATION-WA] whatsapp-service creds missing — owner WA skipped')
      return
    }

    const whatsappUrl = `${supabaseUrl}/functions/v1/whatsapp-service`
    const prettyTime  = /^\d{2}:\d{2}$/.test(event.time) ? formatLocalTime(event.time) : event.time
    const whenHuman   = `${formatDateHuman(event.date)} a las ${prettyTime}`

    const post = (payload: Record<string, unknown>): Promise<boolean> =>
      fetch(whatsappUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
        body:    JSON.stringify({ to: rawPhone, ...payload }),
      })
        .then((r) => r.json().catch(() => ({ success: false })))
        .then((d: { success?: boolean }) => d.success === true)
        .catch(() => false)

    // 1) Template first (delivers outside the 24h window).
    const sentViaTemplate = await post({
      type:         'template',
      template:     OWNER_EVENT_TEMPLATE,
      languageCode: 'es',
      parameters:   [buildTitle(event.type), event.clientName, event.serviceName, whenHuman],
    })
    if (sentViaTemplate) return

    // 2) Free-text fallback (works while the owner's 24h window is open).
    await post({ type: 'text', message: buildOwnerWhatsAppMessage(event) })
  } catch (err) {
    console.warn('[NOTIFICATION-WA] sendOwnerWhatsApp failed (non-critical):', err)
  }
}

/** Web push to the owner's installed PWA via the push-notify edge function. Non-critical. */
export async function sendOwnerWebPush(event: AppointmentEvent): Promise<void> {
  try {
    // @ts-ignore — Deno runtime globals
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-ignore
    const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''
    if (!supabaseUrl || !cronSecret) return

    await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
      body: JSON.stringify({
        business_id: event.businessId,
        title: buildTitle(event.type),
        body:  buildContent(event),
        url:   '/dashboard/appointments',
        tag:   `wa-${event.type}-${event.eventId}`,
      }),
    })
  } catch (err) {
    console.warn('[NOTIFICATION-WA] sendOwnerWebPush failed (non-critical):', err)
  }
}
