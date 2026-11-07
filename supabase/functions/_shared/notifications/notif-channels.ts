/**
 * notif-channels.ts — The side-effect channels for an AppointmentEvent.
 *
 * DB persistence (source of truth + idempotency), Realtime broadcast, owner WhatsApp
 * (template-first, free-text fallback) and owner web push. Each is best-effort and never
 * throws — the booking is already committed — but an owner-WhatsApp degradation is pushed
 * to Sentry instead of being swallowed.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getAdminClient } from "../supabase.ts"
import { captureMessage } from "../sentry.ts"
import {
  type AppointmentEvent,
  buildTitle, buildContent, buildOwnerWhatsAppMessage, notificationKind, ownerWhenText,
} from "./notif-contracts.ts"

let client: SupabaseClient | null = null
/** The service-role client, created on first use (every caller runs with its env). */
function db(): SupabaseClient {
  return (client ??= getAdminClient())
}

/** Idempotency: true when this eventId already has a notification row. */
export async function checkEventExists(eventId: string): Promise<boolean> {
  try {
    const { data, error } = await db()
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
    const { error } = await db().from('notifications').insert({
      business_id: event.businessId,
      title:       buildTitle(event.type),
      content:     buildContent(event),
      type:        notificationKind(event.type),
      is_read:     false,
      event_id:    event.eventId,
      metadata: {
        eventType:   event.type,
        clientName:  event.clientName,
        serviceName: event.serviceName,
        date:        event.date,
        time:        event.time,
        ...(event.requestedDate ? { requestedDate: event.requestedDate } : {}),
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
    const channel = db().channel(`notifications:${event.businessId}`)
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
    await db().removeChannel(channel)
  } catch (err) {
    console.warn('[NOTIFICATION-WA] pushToRealtime failed (non-critical):', err)
  }
}

// Approved Meta template for per-event owner alerts. Configurable via secret so an
// already-approved template can be wired without a redeploy; it MUST have exactly 4 body
// variables in order: {{1}} estado, {{2}} cliente, {{3}} servicio, {{4}} fecha y hora.
// If the template isn't approved, the summary template and then free text take over.
// @ts-ignore — Deno runtime globals
const OWNER_EVENT_TEMPLATE = Deno.env.get('OWNER_EVENT_TEMPLATE') ?? 'owner_event_notification'
// Approved template of the daily summary, used while the event template is not approved: it
// delivers outside the 24h window too. Body: "El resumen diario está listo: {{1}}. Detalles
// adicionales: {{2}}. Gracias."
const OWNER_SUMMARY_TEMPLATE = 'daily_owner_summary'

/** Outcome of one whatsapp-service call — the error string surfaces instead of a bare boolean. */
interface SendOutcome { ok: boolean; error: string | null }

async function postWhatsAppService(
  url: string, secret: string, payload: Record<string, unknown>,
): Promise<SendOutcome> {
  try {
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body:    JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
    if (data?.success === true) return { ok: true, error: null }
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Pushes an owner-alert degradation to Sentry. Event template failure → warning: the alert
 * goes out with the summary template's wording. Summary failure too → warning: the alert now
 * depends on the owner's 24h window (Meta accepting free text does NOT prove delivery —
 * outside the window it is dropped asynchronously). Text failure too → error: the owner
 * got no WhatsApp at all. Bell + push are unaffected.
 */
function reportOwnerSendFailure(step: 'template' | 'summary' | 'text', event: AppointmentEvent, error: string | null): void {
  const extra = { event_type: event.type, business_id: event.businessId, error }
  if (step === 'template') {
    captureMessage('Owner WhatsApp event template send failed — falling back to the summary template', 'warning',
      { stage: 'owner_wa_template_failed', template: OWNER_EVENT_TEMPLATE, ...extra })
  } else if (step === 'summary') {
    captureMessage('Owner WhatsApp summary template send failed — falling back to free text', 'warning',
      { stage: 'owner_wa_summary_failed', template: OWNER_SUMMARY_TEMPLATE, ...extra })
  } else {
    captureMessage('Owner WhatsApp notification undelivered', 'error', { stage: 'owner_wa_undelivered', ...extra })
  }
}

/**
 * Tries each way to reach the owner, stopping at the first accepted. Templates deliver OUTSIDE
 * the 24h window, the whole point of per-event alerts; free text only works inside it.
 */
async function sendOwnerAlert(
  send: (payload: Record<string, unknown>) => Promise<SendOutcome>, event: AppointmentEvent,
): Promise<void> {
  const title = buildTitle(event.type)
  const when  = ownerWhenText(event)

  const viaEventTemplate = await send({
    type: 'template', template: OWNER_EVENT_TEMPLATE, languageCode: 'es',
    parameters: [title, event.clientName, event.serviceName, when],
  })
  if (viaEventTemplate.ok) return
  reportOwnerSendFailure('template', event, viaEventTemplate.error)

  const viaSummaryTemplate = await send({
    type: 'template', template: OWNER_SUMMARY_TEMPLATE, languageCode: 'es',
    parameters: [title, `${event.clientName} · ${event.serviceName} · ${when}`],
  })
  if (viaSummaryTemplate.ok) return
  reportOwnerSendFailure('summary', event, viaSummaryTemplate.error)

  const viaText = await send({ type: 'text', message: buildOwnerWhatsAppMessage(event) })
  if (!viaText.ok) reportOwnerSendFailure('text', event, viaText.error)
}

/** Owner WhatsApp via the whatsapp-service edge function (single WA transport point). Best-effort. */
export async function sendOwnerWhatsApp(event: AppointmentEvent): Promise<void> {
  try {
    // @ts-ignore — Deno runtime globals
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-ignore
    const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''

    // Owner's verified WhatsApp is stored in businesses.phone (set via VINCULAR-slug).
    const { data: bData, error: bError } = await db()
      .from('businesses').select('phone').eq('id', event.businessId).maybeSingle()
    if (bError) {
      console.warn('[NOTIFICATION-WA] Owner phone lookup failed — WA notification skipped:', bError.message)
      return
    }

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
    await sendOwnerAlert(
      (payload) => postWhatsAppService(whatsappUrl, cronSecret, {
        to: rawPhone, ...payload,
        track: { businessId: event.businessId, purpose: 'owner_alert' },
      }),
      event,
    )
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
