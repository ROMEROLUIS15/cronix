/**
 * notifications.ts — Emisión de eventos de cita para el pipeline WhatsApp.
 *
 * ── Principio rector ──────────────────────────────────────────────────────────
 * Este módulo NO escribe directamente en la tabla notifications.
 * NO llama a la Meta API directamente para notificaciones de owner.
 * Todo pasa por emitBookingEvent(), que replica el contrato de NotificationService
 * dentro del runtime Deno (no puede importar módulos Next.js).
 *
 * ── Garantías (mismo contrato que NotificationService) ──────────────────────
 * - Idempotencia: eventId único → exactamente UNA notificación en DB
 * - Orden: DB → Realtime → WhatsApp owner (WA solo si DB fue exitosa)
 * - Fail-safe: cada canal falla silenciosamente con log de error
 * - El booking NO se interrumpe por fallos en notificaciones
 *
 * ── Flujo unificado ───────────────────────────────────────────────────────────
 * tool-executor.ts → emitBookingEvent() → [idempotency check] → DB
 *                                        → Realtime broadcast
 *                                        → whatsapp-service edge function (owner)
 */

import { supabase }     from "./db-client.ts"
import { captureException } from "../_shared/sentry.ts"
import { utcToLocalParts } from "./time-utils.ts"
import { formatLocalTime } from "./prompt-builder.ts"
import type { BusinessRagContext } from "./types.ts"

// ── AppointmentEvent contract (mirrors lib/ai/orchestrator/events.ts) ─────────

type AppointmentEventType =
  | 'appointment.created'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'

interface AppointmentEvent {
  eventId:      string
  type:         AppointmentEventType
  businessId:   string
  businessName: string
  clientName:   string
  serviceName:  string
  date:         string
  time:         string
  userId:       string
  channel:      'whatsapp'
}

// ── Title / Content builders (mirrors NotificationService helpers) ─────────────

function buildTitle(type: AppointmentEventType): string {
  switch (type) {
    case 'appointment.created':    return 'Nueva cita agendada'
    case 'appointment.rescheduled': return 'Cita reagendada'
    case 'appointment.cancelled':  return 'Cita cancelada'
  }
}

function buildContent(event: AppointmentEvent): string {
  const base = `${event.clientName} — ${event.serviceName} el ${event.date} a las ${event.time}`
  switch (event.type) {
    case 'appointment.created':    return `Nueva cita: ${base}`
    case 'appointment.rescheduled': return `Reagendada: ${base}`
    case 'appointment.cancelled':  return `Cancelada: ${base}`
  }
}

function buildOwnerWhatsAppMessage(event: AppointmentEvent): string {
  // Convert HH:mm (24h) → "h:mm am/pm"; fall back to raw value if format unexpected.
  const prettyTime = /^\d{2}:\d{2}$/.test(event.time) ? formatLocalTime(event.time) : event.time
  switch (event.type) {
    case 'appointment.created':
      return (
        `¡Hola! 👋🤖\n\n` +
        `Ha sido agendada una cita para *${event.clientName}* el día *${event.date}* a las *${prettyTime}*\n` +
        `Servicio: *${event.serviceName}*\n\n` +
        `¡Reserva confirmada vía WhatsApp! 💪🚀`
      )
    case 'appointment.rescheduled':
      return (
        `¡Reagenda! 🔄🤖\n\n` +
        `*${event.clientName}* movió su cita de *${event.serviceName}*.\n` +
        `Nueva fecha: *${event.date}* a las *${prettyTime}*\n\n` +
        `¡Tu agenda ha sido actualizada! 💪🚀`
      )
    case 'appointment.cancelled':
      return (
        `¡Cita cancelada! ❌🤖\n\n` +
        `*${event.clientName}* canceló su cita de *${event.serviceName}*` +
        (event.date ? ` del *${event.date}* a las *${prettyTime}*` : '') +
        `.\n\n¡Tienes un nuevo espacio libre! 💪🚀`
      )
  }
}

// ── Core: idempotency check ───────────────────────────────────────────────────

async function checkEventExists(eventId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle()

    if (error) return false  // falla segura: tratar como no procesado
    return data !== null
  } catch {
    return false
  }
}

// ── Core: persist to DB ───────────────────────────────────────────────────────

async function saveNotificationToDB(event: AppointmentEvent): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
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

// ── Core: Realtime broadcast ──────────────────────────────────────────────────

async function pushToRealtime(event: AppointmentEvent): Promise<void> {
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
    // Non-critical: DB already has the record
    console.warn('[NOTIFICATION-WA] pushToRealtime failed (non-critical):', err)
  }
}

// ── Core: WhatsApp owner notification via whatsapp-service edge function ───────
// whatsapp-service is the single WA transport point for the whole system.
// We pass type:'text' + message so the service sends free-text instead of a template.

async function sendOwnerWhatsApp(event: AppointmentEvent, businessName: string): Promise<void> {
  try {
    // @ts-ignore — Deno runtime globals
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? ''
    // @ts-ignore
    const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')   ?? ''

    if (!phoneNumberId || !accessToken) {
      console.warn('[NOTIFICATION-WA] WHATSAPP credentials not set — owner WA skipped')
      return
    }

    // Owner's verified WhatsApp is stored in businesses.phone (set via VINCULAR-slug)
    const { data: bData } = await supabase
      .from('businesses')
      .select('phone')
      .eq('id', event.businessId)
      .maybeSingle()

    const rawPhone = (bData as { phone?: string | null })?.phone

    if (!rawPhone) {
      console.warn('[NOTIFICATION-WA] No owner phone found for business, skipping WA notification', event.businessId)
      return
    }

    // Normalize phone: strip spaces, dashes, parens, leading +
    // businesses.phone is stored WITHOUT '+' (e.g. '584247092980')
    // Meta Graph API expects the number WITHOUT '+', as E.164 digits only
    const phone = rawPhone.replace(/[\s\-\+\(\)]/g, '')

    const message = buildOwnerWhatsAppMessage(event)

    // Call Meta Graph API directly with a free-text message.
    // NOTE: whatsapp-service only supports the appointment_reminder TEMPLATE,
    // so we bypass it here and call Meta directly for owner notifications.
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                phone,
        type:              'text',
        text:              { body: message },
      }),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      console.warn('[NOTIFICATION-WA] Meta API error:', (errBody as { error?: { message?: string } })?.error?.message ?? res.status)
    }
  } catch (err) {
    // Non-critical — booking already committed, notification is best-effort
    console.warn('[NOTIFICATION-WA] sendOwnerWhatsApp failed (non-critical):', err)
  }
}

// ── Public API ── the only function exported from this module ─────────────────

/**
 * Emite un AppointmentEvent al pipeline de notificaciones.
 *
 * Identical contract to NotificationService.handle() but native to Deno runtime:
 *   1. Idempotency check (event_id in DB)
 *   2. Persist to notifications table
 *   3. Realtime broadcast
 *   4. WhatsApp to owner via whatsapp-service edge function (type:'text')
 *
 * Fire-and-forget safe: nunca lanza excepciones al caller.
 * El booking ya fue completado cuando esto se llama.
 */
export async function emitBookingEvent(event: AppointmentEvent): Promise<void> {
  try {
    // 1. Idempotency
    const alreadyProcessed = await checkEventExists(event.eventId)
    if (alreadyProcessed) {
      console.info('[NOTIFICATION-WA] Event already processed — skipping', event.eventId)
      return
    }

    // 2. DB (source of truth — must succeed before continuing)
    const saved = await saveNotificationToDB(event)
    if (!saved) return

    // 3. Realtime UI (independent, fail-safe)
    await pushToRealtime(event)

    // 4. WhatsApp owner (only if DB succeeded)
    await sendOwnerWhatsApp(event, event.businessName)

  } catch (err) {
    captureException(err, { stage: 'emit_booking_event', eventId: event.eventId })
  }
}

// ── Convenience builders (called from tool-executor.ts) ───────────────────────
// Replace the old fireOwnerNotifications / fireCancelNotifications / fireRescheduleNotifications.
// Each constructs a typed AppointmentEvent and calls emitBookingEvent (fire-and-forget).

// Deterministic event IDs: same tool + same appointment + same date/time = same eventId.
// Prevents duplicate owner notifications when the ReAct loop or QStash retries
// re-invoke the same tool call. Idempotency check in emitBookingEvent relies on this.
function buildEventId(type: string, businessId: string, appointmentId: string, date: string, time: string): string {
  return `${type}:${businessId}:${appointmentId}:${date}:${time}`
}

export function emitCreatedEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  date:          string,
  time:          string,
  appointmentId: string,
): void {
  void emitBookingEvent({
    eventId:      buildEventId('created', business.id, appointmentId, date, time),
    type:         'appointment.created',
    businessId:   business.id,
    businessName: business.name,
    clientName,
    serviceName,
    date,
    time,
    userId:       'whatsapp-agent',
    channel:      'whatsapp',
  })
}

export function emitRescheduledEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  appointmentId: string,
  newDate:       string,
  newTime:       string,
): void {
  void emitBookingEvent({
    eventId:      buildEventId('rescheduled', business.id, appointmentId, newDate, newTime),
    type:         'appointment.rescheduled',
    businessId:   business.id,
    businessName: business.name,
    clientName,
    serviceName,
    date:         newDate,
    time:         newTime,
    userId:       'whatsapp-agent',
    channel:      'whatsapp',
  })
}

export function emitCancelledEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  appointmentId: string,
  oldStartAt:    string,
): void {
  // Convert the stored UTC ISO start_at to the business's local tz for humans.
  const { date, time } = utcToLocalParts(oldStartAt, business.timezone)

  void emitBookingEvent({
    eventId:      buildEventId('cancelled', business.id, appointmentId, date, time),
    type:         'appointment.cancelled',
    businessId:   business.id,
    businessName: business.name,
    clientName,
    serviceName,
    date,
    time,
    userId:       'whatsapp-agent',
    channel:      'whatsapp',
  })
}
