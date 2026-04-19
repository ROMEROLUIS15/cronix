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
  switch (event.type) {
    case 'appointment.created':
      return (
        `¡Hola! 👋🤖\n\n` +
        `Ha sido agendada una cita para *${event.clientName}* el día *${event.date}* a las *${event.time}*\n` +
        `Servicio: *${event.serviceName}*\n\n` +
        `¡Reserva confirmada vía WhatsApp! 💪🚀`
      )
    case 'appointment.rescheduled':
      return (
        `¡Reagenda! 🔄🤖\n\n` +
        `*${event.clientName}* movió su cita de *${event.serviceName}*.\n` +
        `Nueva fecha: *${event.date}* a las *${event.time}*\n\n` +
        `¡Tu agenda ha sido actualizada! 💪🚀`
      )
    case 'appointment.cancelled':
      return (
        `¡Cita cancelada! ❌🤖\n\n` +
        `*${event.clientName}* canceló su cita de *${event.serviceName}*` +
        (event.date ? ` del *${event.date}* a las *${event.time}*` : '') +
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-ignore
    const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''

    if (!cronSecret) {
      console.warn('[NOTIFICATION-WA] CRON_SECRET not set — owner WA skipped')
      return
    }

    // Owner's verified WhatsApp is stored in businesses.phone (set via VINCULAR-slug)
    const { data: bData } = await supabase
      .from('businesses')
      .select('phone')
      .eq('id', event.businessId)
      .maybeSingle()

    const phone = (bData as { phone?: string | null })?.phone

    if (!phone) {
      console.warn('[NOTIFICATION-WA] No owner phone found for business, skipping WA notification', event.businessId)
      return
    }

    const message = buildOwnerWhatsAppMessage(event)

    await fetch(`${supabaseUrl}/functions/v1/whatsapp-service`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-internal-secret': cronSecret,
      },
      body: JSON.stringify({
        type:         'text',
        to:           phone,
        message,
        // kept for traceability in whatsapp-service logs
        clientName:   event.clientName,
        businessName,
      }),
    })
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

export function emitCreatedEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  date:          string,
  time:          string,
  appointmentId: string,
): void {
  void emitBookingEvent({
    // @ts-ignore — crypto is available in Deno
    eventId:      crypto.randomUUID(),
    type:         'appointment.created',
    businessId:   business.id,
    businessName: business.name,
    clientName,
    serviceName,
    date,
    time,
    // In the WhatsApp channel the client is unauthenticated (no Supabase userId).
    // 'whatsapp-agent' is a stable sentinel that identifies this origin in audit logs.
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
    // @ts-ignore
    eventId:      crypto.randomUUID(),
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
  // Extract date/time from the ISO start_at string
  const date = oldStartAt.slice(0, 10)   // YYYY-MM-DD
  const time = oldStartAt.slice(11, 16)  // HH:mm

  void emitBookingEvent({
    // @ts-ignore
    eventId:      crypto.randomUUID(),
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
