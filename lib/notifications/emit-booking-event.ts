import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { Result, ok, fail } from '@/types/result'
import { logger } from '@/lib/logger'
import type { AppointmentEvent } from './appointment-event'

type Supabase = SupabaseClient<Database>

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTitle(type: AppointmentEvent['type']): string {
  switch (type) {
    case 'appointment.created':     return 'Nueva cita agendada'
    case 'appointment.rescheduled': return 'Cita reagendada'
    case 'appointment.cancelled':   return 'Cita cancelada'
  }
}

function buildContent(event: AppointmentEvent): string {
  const base = `${event.clientName} — ${event.serviceName} el ${event.date} a las ${event.time}`
  switch (event.type) {
    case 'appointment.created':     return `Nueva cita: ${base}`
    case 'appointment.rescheduled': return `Reagendada: ${base}`
    case 'appointment.cancelled':   return `Cancelada: ${base}`
  }
}

// ── Channel 1: DB (fuente de verdad) ──────────────────────────────────────────

async function checkEventExists(supabase: Supabase, eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) return false
  return data !== null
}

async function saveNotificationToDB(
  supabase: Supabase,
  event: AppointmentEvent,
): Promise<boolean> {
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
    logger.error('NOTIFICATION-DASH', 'saveNotificationToDB failed', { message: error.message, eventId: event.eventId })
    return false
  }
  return true
}

// ── Channel 2: Supabase Realtime broadcast ────────────────────────────────────

async function pushToRealtime(supabase: Supabase, event: AppointmentEvent): Promise<void> {
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
    logger.warn('NOTIFICATION-DASH', 'pushToRealtime failed (non-critical)', err)
  }
}

// ── Channel 3: WhatsApp al dueño (Meta Graph API) ─────────────────────────────

async function sendOwnerWhatsApp(
  supabase: Supabase,
  event: AppointmentEvent,
): Promise<void> {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''
    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN ?? ''

    if (!phoneNumberId || !accessToken) {
      logger.warn('NOTIFICATION-DASH', 'WHATSAPP credentials not set — owner WA skipped')
      return
    }

    const { data: bData } = await supabase
      .from('businesses')
      .select('phone')
      .eq('id', event.businessId)
      .maybeSingle()

    const rawPhone = bData?.phone ?? null

    if (!rawPhone) {
      logger.warn('NOTIFICATION-DASH', 'No owner phone — WA skipped', { businessId: event.businessId })
      return
    }

    const phone = rawPhone.replace(/[\s\-\+\(\)]/g, '')

    const message = buildOwnerWhatsAppMessage(event)

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
      logger.warn('NOTIFICATION-DASH', 'Meta API error', (errBody as { error?: { message?: string } })?.error?.message ?? String(res.status))
    }
  } catch (err) {
    logger.warn('NOTIFICATION-DASH', 'sendOwnerWhatsApp failed (non-critical)', err)
  }
}

function buildOwnerWhatsAppMessage(event: AppointmentEvent): string {
  const time = event.time
  switch (event.type) {
    case 'appointment.created':
      return (
        `¡Hola! 👋🤖\n\n` +
        `Ha sido agendada una cita para *${event.clientName}* el día *${event.date}* a las *${time}*\n` +
        `Servicio: *${event.serviceName}*\n\n` +
        `¡Reserva confirmada vía Dashboard! 💪🚀`
      )
    case 'appointment.rescheduled':
      return (
        `¡Reagenda! 🔄\n\n` +
        `*${event.clientName}* movió su cita de *${event.serviceName}*.\n` +
        `Nueva fecha: *${event.date}* a las *${time}*\n\n` +
        `¡Tu agenda ha sido actualizada! 💪🚀`
      )
    case 'appointment.cancelled':
      return (
        `¡Cita cancelada! ❌\n\n` +
        `*${event.clientName}* canceló su cita de *${event.serviceName}*` +
        (event.date ? ` del *${event.date}* a las *${time}*` : '') +
        `.\n\n¡Tienes un nuevo espacio libre! 💪🚀`
      )
  }
}

// ── Channel 4: Web Push al PWA del dueño ──────────────────────────────────────

async function sendOwnerWebPush(event: AppointmentEvent): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const cronSecret  = process.env.CRON_SECRET ?? ''
    if (!supabaseUrl || !cronSecret) return

    await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': cronSecret },
      body: JSON.stringify({
        business_id: event.businessId,
        title:       buildTitle(event.type),
        body:        buildContent(event),
        url:         '/dashboard/appointments',
        tag:         `dash-${event.type}-${event.eventId}`,
      }),
    })
  } catch (err) {
    logger.warn('NOTIFICATION-DASH', 'sendOwnerWebPush failed (non-critical)', err)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function emitBookingEvent(
  supabase: Supabase,
  event: AppointmentEvent,
): Promise<Result<void>> {
  try {
    const alreadyProcessed = await checkEventExists(supabase, event.eventId)
    if (alreadyProcessed) {
      logger.info('NOTIFICATION-DASH', 'Event already processed — skipping', { eventId: event.eventId })
      return ok(undefined)
    }

    const saved = await saveNotificationToDB(supabase, event)
    if (!saved) return ok(undefined)

    await pushToRealtime(supabase, event)
    await sendOwnerWhatsApp(supabase, event)
    await sendOwnerWebPush(event)

    return ok(undefined)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('NOTIFICATION-DASH', 'emitBookingEvent error', { message, eventId: event.eventId })
    return fail(message)
  }
}
