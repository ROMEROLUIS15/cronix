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
import { sendWhatsAppMessage } from "./whatsapp.ts"
import { buildAppointmentEventId } from "../_shared/notifications/event-id.ts"
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
//
// Strategy (mirrors cron-reminders/sendOwnerWhatsAppSummary): try the approved
// Meta TEMPLATE first — a template delivers OUTSIDE the 24h customer-service window,
// which is the whole point of per-event owner alerts (a booking can land at any hour
// when the owner hasn't messaged the bot recently). If the template send fails
// (pending approval / quota / etc.) we fall back to free-form text, which still works
// while the owner's 24h window is open. Booking is already committed → best-effort.

// Approved Meta template for per-event owner alerts. Configurable via secret so an
// already-approved template can be wired without a redeploy; it MUST have exactly 4
// body variables, in this order: {{1}} estado, {{2}} cliente, {{3}} servicio, {{4}}
// fecha y hora. If the template isn't approved, the free-text fallback takes over.
// @ts-ignore — Deno runtime globals
const OWNER_EVENT_TEMPLATE = Deno.env.get('OWNER_EVENT_TEMPLATE') ?? 'owner_event_notification'

function formatDateHuman(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

async function sendOwnerWhatsApp(event: AppointmentEvent, _businessName: string): Promise<void> {
  try {
    // @ts-ignore — Deno runtime globals
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-ignore
    const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''

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
    // Non-critical — booking already committed, notification is best-effort
    console.warn('[NOTIFICATION-WA] sendOwnerWhatsApp failed (non-critical):', err)
  }
}

// ── Core: Web push to owner's PWA via push-notify edge function ───────────────

async function sendOwnerWebPush(event: AppointmentEvent): Promise<void> {
  try {
    // @ts-ignore — Deno runtime globals
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-ignore
    const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''
    if (!supabaseUrl || !cronSecret) return

    await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
      method: 'POST',
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

    // 5. Web push to owner's installed PWA (fire-and-forget)
    await sendOwnerWebPush(event)

  } catch (err) {
    captureException(err, { stage: 'emit_booking_event', eventId: event.eventId })
  }
}

// ── Client notification ───────────────────────────────────────────────────────
// Sends a dedicated WA confirmation message directly to the client's phone.
// Called fire-and-forget from tool-executor.ts after each successful booking action.
// This is separate from the conversational reply the agent sends back — it provides
// a formal, business-branded record the client can reference later.

function buildClientWhatsAppMessage(
  type:         AppointmentEventType,
  businessName: string,
  serviceName:  string,
  date:         string,
  time:         string,
): string {
  const prettyTime = /^\d{2}:\d{2}$/.test(time) ? formatLocalTime(time) : time
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dateStr   = new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  switch (type) {
    case 'appointment.created':
      return (
        `✅ ¡Listo! Tu cita en *${businessName}* ha sido agendada para el ${dateStr} ` +
        `a las ${prettyTime} para el servicio de *${serviceName}*.\n\n¡Te esperamos! 🎉`
      )
    case 'appointment.rescheduled':
      return (
        `🔄 Tu cita en *${businessName}* ha sido reagendada al ${dateStr} ` +
        `a las ${prettyTime} para el servicio de *${serviceName}*.\n\n¡Te esperamos en tu nuevo horario! 💪`
      )
    case 'appointment.cancelled':
      return (
        `❌ Tu cita de *${serviceName}* en *${businessName}*` +
        (date ? ` del ${dateStr} a las ${prettyTime}` : '') +
        ` ha sido cancelada.\n\nCuando quieras agendar de nuevo, aquí estamos. 😊`
      )
  }
}

/**
 * Sends a WhatsApp booking confirmation to the client's phone.
 * Fire-and-forget safe — never throws, non-blocking.
 *
 * @param clientPhone  WhatsApp sender number (digits only, no +)
 * @param eventType    'created' | 'rescheduled' | 'cancelled'
 * @param businessName Display name shown to the client
 * @param serviceName  Service the appointment is for
 * @param date         YYYY-MM-DD (local business timezone)
 * @param time         HH:mm 24h (local business timezone)
 */
export async function sendClientBookingConfirmation(
  clientPhone:  string,
  eventType:    'created' | 'rescheduled' | 'cancelled',
  businessName: string,
  serviceName:  string,
  date:         string,
  time:         string,
): Promise<void> {
  if (!clientPhone) return
  const message = buildClientWhatsAppMessage(
    `appointment.${eventType}` as AppointmentEventType,
    businessName,
    serviceName,
    date,
    time,
  )
  try {
    await sendWhatsAppMessage(clientPhone, message)
  } catch (err) {
    // Non-critical: booking already committed, client WA notification is best-effort
    console.warn('[NOTIFICATION-WA] sendClientBookingConfirmation failed (non-critical):', err)
  }
}

// ── Convenience builders (called from tool-executor.ts) ───────────────────────
// Replace the old fireOwnerNotifications / fireCancelNotifications / fireRescheduleNotifications.
// Each constructs a typed AppointmentEvent and calls emitBookingEvent (fire-and-forget).

// Deterministic event IDs come from the shared contract (buildAppointmentEventId):
// same action + same appointment + same date/time = same eventId. Prevents
// duplicate owner notifications when the ReAct loop or QStash retries re-invoke
// the same tool call. Idempotency check in emitBookingEvent relies on this.

export function emitCreatedEvent(
  business:      BusinessRagContext['business'],
  clientName:    string,
  serviceName:   string,
  date:          string,
  time:          string,
  appointmentId: string,
): void {
  void emitBookingEvent({
    eventId:      buildAppointmentEventId('created', business.id, appointmentId, date, time),
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
    eventId:      buildAppointmentEventId('rescheduled', business.id, appointmentId, newDate, newTime),
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
    eventId:      buildAppointmentEventId('cancelled', business.id, appointmentId, date, time),
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
