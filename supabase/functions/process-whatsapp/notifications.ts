/**
 * Owner Notifications — WhatsApp AI Agent
 *
 * Handles all post-action owner alerting for booking events:
 *  - In-app bell notification (always fires)
 *  - PWA web push (confirm only)
 *  - WhatsApp message to business owner (if phone configured)
 *
 * Exposes:
 *  - sendWhatsAppWithRetry  → fire-and-forget WhatsApp with one 2s retry
 *  - fireOwnerNotifications → all 3 channels for a new booking confirmation
 */

import type { BusinessRagContext } from "./types.ts"
import { captureException }        from "../_shared/sentry.ts"
import { sendWhatsAppMessage }     from "./whatsapp.ts"
import { createInternalNotification } from "./audit.ts"
import { formatLocalTime }         from "./prompt-builder.ts"

// ── WhatsApp with Retry ───────────────────────────────────────────────────────

/**
 * Wraps sendWhatsAppMessage with a single retry after 2 s.
 * Owner notifications are fire-and-forget but deserve one retry before giving up,
 * since a transient Meta API hiccup would otherwise leave the owner uninformed.
 */
export async function sendWhatsAppWithRetry(to: string, text: string): Promise<void> {
  try {
    await sendWhatsAppMessage(to, text)
  } catch {
    await new Promise(r => setTimeout(r, 2000))
    await sendWhatsAppMessage(to, text) // throws on second failure — caught by caller
  }
}

// ── Reschedule Notifications ──────────────────────────────────────────────────

export async function fireRescheduleNotifications(
  business:      BusinessRagContext['business'],
  clientName:    string,
  svcName:       string,
  appointmentId: string,
  oldStartAt:    string,
  newDate:       string,
  newTime:       string,
): Promise<void> {
  const oldDateObj       = new Date(oldStartAt)
  const oldDateStr       = new Intl.DateTimeFormat('es-ES', { timeZone: business.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(oldDateObj)
  const oldTimeStr       = new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(oldDateObj).toLowerCase()
  const newTimeFormatted = formatLocalTime(newTime)

  // Channel 0: In-app bell — always fires regardless of phone config
  createInternalNotification(
    business.id,
    'Cita Reagendada 🔄',
    `${clientName} movió su cita de ${svcName} al ${newDate} a las ${newTimeFormatted}`,
    'info',
    { appointment_id: appointmentId },
  ).catch(err => captureException(err, { stage: 'inapp_notification_reschedule', business_id: business.id }))

  // Channel 1: WhatsApp to owner — only if phone is configured
  if (business.phone) {
    const ownerPhone = business.phone.replace(/\D/g, '')
    const waNotif =
      `¡Hola equipo de *${business.name}*! 👋🤖\n\n` +
      `El cliente *${clientName}* ha *reagendado* su cita de *${svcName}*.\n\n` +
      `❌ Espacio liberado: *${oldDateStr}* a las *${oldTimeStr}*\n` +
      `✅ Nuevo espacio reservado: *${newDate}* a las *${newTimeFormatted}*\n\n` +
      `¡Tu agenda ha sido actualizada correctamente! 💪🚀`

    sendWhatsAppWithRetry(ownerPhone, waNotif)
      .catch(err => captureException(err, { stage: 'wa_notify_owner_reschedule', business_id: business.id }))
  }
}

// ── Cancel Notifications ──────────────────────────────────────────────────────

export async function fireCancelNotifications(
  business:      BusinessRagContext['business'],
  clientName:    string,
  svcName:       string,
  appointmentId: string,
  oldStartAt:    string,
): Promise<void> {
  const oldDateObj = new Date(oldStartAt)
  const oldDateStr = new Intl.DateTimeFormat('es-ES', { timeZone: business.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(oldDateObj)
  const oldTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(oldDateObj).toLowerCase()

  // Channel 0: In-app bell — always fires regardless of phone config
  createInternalNotification(
    business.id,
    'Cita Cancelada ❌',
    `${clientName} canceló su cita de ${svcName} del ${oldDateStr} a las ${oldTimeStr}`,
    'warning',
    { appointment_id: appointmentId },
  ).catch(err => captureException(err, { stage: 'inapp_notification_cancel', business_id: business.id }))

  // Channel 1: WhatsApp to owner — only if phone is configured
  if (business.phone) {
    const ownerPhone = business.phone.replace(/\D/g, '')
    const waNotif =
      `¡Hola equipo de *${business.name}*! 👋🤖\n\n` +
      `El cliente *${clientName}* ha *cancelado* su cita, por lo que tienes un nuevo espacio libre el día *${oldDateStr}* a las *${oldTimeStr}* para el servicio: *${svcName}*.\n\n` +
      `¡Sigo activo para atender y asignarle este nuevo espacio libre a otro cliente! 💪🚀`

    sendWhatsAppWithRetry(ownerPhone, waNotif)
      .catch(err => captureException(err, { stage: 'wa_notify_owner_cancel', business_id: business.id }))
  }
}

// ── Confirm Notifications ─────────────────────────────────────────────────────

export async function fireOwnerNotifications(
  business:      BusinessRagContext['business'],
  clientName:    string,
  svcName:       string,
  date:          string,
  formattedTime: string,
  appointmentId: string,
): Promise<void> {
  // @ts-ignore — Deno runtime global
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''

  // Channel 0: In-App Notification (Dashboard Bell)
  createInternalNotification(
    business.id,
    'Nueva Cita Agendada 📅',
    `${clientName} reservó ${svcName} para el ${date} a las ${formattedTime}`,
    'success',
    { appointment_id: appointmentId },
  ).catch(err => captureException(err, { stage: 'inapp_notification_confirm', business_id: business.id }))

  // Channel 1: Web Push notification (PWA)
  fetch(`${supabaseUrl}/functions/v1/push-notify`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-internal-secret': cronSecret,
    },
    body: JSON.stringify({
      business_id: business.id,
      title:       '¡Nueva Reserva! 📅',
      body:        `${clientName} · ${svcName} — ${date} ${formattedTime} ✅`,
      url:         '/dashboard',
    }),
  }).catch(err => captureException(err, { stage: 'push_new_booking', business_id: business.id }))

  // Channel 2: WhatsApp message to business owner
  if (business.phone) {
    const ownerPhone = business.phone.replace(/\D/g, '')
    const waNotif =
      `¡Hola equipo de *${business.name}*! 👋🤖\n\n` +
      `Ha sido agendada una cita para *${clientName}* el día *${date}* a las *${formattedTime}*\n` +
      `Servicio: *${svcName}*\n\n` +
      `¡Sigo trabajando a toda máquina para mantener tu agenda llena! 💪🚀`

    sendWhatsAppWithRetry(ownerPhone, waNotif)
      .catch(err => captureException(err, { stage: 'wa_notify_owner_confirm', business_id: business.id }))
  }
}
