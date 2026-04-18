/**
 * notification-service.ts — Servicio centralizado de notificaciones.
 *
 * Responsabilidad: procesar un AppointmentEvent y disparar los 3 canales
 * en orden determinista: DB → Realtime UI → WhatsApp.
 *
 * ── Principio rector ──────────────────────────────────────────────────────────
 * El sistema de notificaciones es eventual-consistent.
 * La fuente de verdad es la base de datos de appointments.
 * Las notificaciones son derivadas, nunca críticas.
 *
 * ── Garantías ─────────────────────────────────────────────────────────────────
 * - Idempotencia: un eventId genera exactamente UNA notificación en el sistema
 * - Orden: DB → Realtime → WhatsApp (WA solo si DB fue exitosa)
 * - Fail-safe: cada canal falla silenciosamente con logger.warn
 * - No lanza excepciones al caller en ningún caso
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { AppointmentEvent, AppointmentEventType } from '@/lib/ai/orchestrator/events'
import { logger } from '@/lib/logger'

// ── Interface pública ──────────────────────────────────────────────────────────
// Exportada para que execution-engine.ts dependa de la abstracción, no de la clase.

export interface INotificationService {
  handle(event: AppointmentEvent): Promise<void>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function buildWhatsAppMessage(event: AppointmentEvent): string {
  switch (event.type) {
    case 'appointment.created':
    case 'appointment.rescheduled':
      return `Tu cita fue confirmada para ${event.date} a las ${event.time} - ${event.serviceName}`
    case 'appointment.cancelled':
      return `Tu cita de ${event.serviceName} el ${event.date} a las ${event.time} fue cancelada`
  }
}

// ── NotificationService ────────────────────────────────────────────────────────

export class NotificationService implements INotificationService {
  constructor(
    /**
     * SupabaseClient inyectado desde orchestrator-factory.
     * Se usa para:
     *   - INSERT en public.notifications (con service_role para bypasear RLS)
     *   - Broadcast en Realtime channel
     *   - Invoke de edge function whatsapp-service
     */
    private readonly supabase: SupabaseClient<Database>,
  ) {}

  // ── Entry point ──────────────────────────────────────────────────────────────

  async handle(event: AppointmentEvent): Promise<void> {
    // ── 1. Idempotency check ───────────────────────────────────────────────────
    // Verificar en DB si este eventId ya fue procesado.
    // Si existe → salir silenciosamente (no duplicar nada).
    const alreadyProcessed = await this.checkEventExists(event.eventId)
    if (alreadyProcessed) {
      logger.info('NOTIFICATION-SVC', 'Event already processed — skipping', {
        eventId:   event.eventId,
        eventType: event.type,
      })
      return
    }

    // ── 2. DB (fuente de verdad de notificaciones) ─────────────────────────────
    // Si falla → no continuar (Realtime y WA dependen de que DB esté ok)
    const saved = await this.saveNotificationToDB(event)
    if (!saved) return

    // ── 3. Realtime UI ────────────────────────────────────────────────────────
    // Independiente — falla silenciosamente
    await this.pushToRealtimeUI(event)

    // ── 4. WhatsApp ───────────────────────────────────────────────────────────
    // SOLO se envía si DB fue exitosa (paso 2)
    await this.sendWhatsAppNotification(event)
  }

  // ── Private: Idempotency check ───────────────────────────────────────────────

  private async checkEventExists(eventId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('notifications')
        .select('id')
        .eq('event_id', eventId)
        .maybeSingle()

      if (error) {
        logger.warn('NOTIFICATION-SVC', 'Idempotency check failed', { eventId, error: error.message })
        // En caso de error al verificar, tratamos como no procesado (mejor duplicar que perder)
        return false
      }

      return data !== null
    } catch (err) {
      logger.warn('NOTIFICATION-SVC', 'Idempotency check threw', { eventId, err })
      return false
    }
  }

  // ── Private: Save to DB ──────────────────────────────────────────────────────

  /**
   * Persiste la notificación en public.notifications.
   * TTL: 30 días (expires_at).
   * Incluye event_id para deduplicación persistent.
   *
   * @returns true si se guardó correctamente, false si falló.
   */
  private async saveNotificationToDB(event: AppointmentEvent): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('notifications')
        .insert({
          business_id: event.businessId,
          title:       buildTitle(event.type),
          content:     buildContent(event),
          type:        event.type === 'appointment.cancelled' ? 'warning' : 'success',
          is_read:     false,
          event_id:    event.eventId,
          // expires_at tiene DEFAULT (now() + 30 days) en DB — no necesario aquí
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
        logger.warn('NOTIFICATION-SVC', 'saveNotificationToDB failed', {
          eventId:    event.eventId,
          businessId: event.businessId,
          error:      error.message,
        })
        return false
      }

      logger.info('NOTIFICATION-SVC', 'Notification saved to DB', {
        eventId:   event.eventId,
        eventType: event.type,
      })
      return true
    } catch (err) {
      logger.warn('NOTIFICATION-SVC', 'saveNotificationToDB threw', { eventId: event.eventId, err })
      return false
    }
  }

  // ── Private: Realtime broadcast ──────────────────────────────────────────────

  /**
   * Broadcast al canal Realtime `notifications:{businessId}`.
   * El dashboard escucha este canal para actualizar la campana en tiempo real.
   * Falla silenciosamente — el dato ya está en DB.
   */
  private async pushToRealtimeUI(event: AppointmentEvent): Promise<void> {
    try {
      const channel = this.supabase.channel(`notifications:${event.businessId}`)

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

      // Limpiar el canal temporal (no guardamos subscripción)
      await this.supabase.removeChannel(channel)

      logger.info('NOTIFICATION-SVC', 'Realtime broadcast sent', {
        eventId:    event.eventId,
        businessId: event.businessId,
      })
    } catch (err) {
      logger.warn('NOTIFICATION-SVC', 'pushToRealtimeUI failed (non-critical)', {
        eventId:    event.eventId,
        businessId: event.businessId,
        err,
      })
    }
  }

  // ── Private: WhatsApp notification ───────────────────────────────────────────

  /**
   * Notifica al dueño del negocio vía WhatsApp invocando la Edge Function.
   * Solo se ejecuta después de que DB fue exitosa.
   *
   * Usa el teléfono del owner registrado en public.users para este business.
   * Falla silenciosamente si el owner no tiene teléfono o la Edge Function falla.
   */
  private async sendWhatsAppNotification(event: AppointmentEvent): Promise<void> {
    try {
      // Obtener el teléfono del owner del negocio
      const ownerPhone = await this.getOwnerPhone(event.businessId)
      if (!ownerPhone) {
        logger.info('NOTIFICATION-SVC', 'No owner phone — skipping WhatsApp', {
          eventId:    event.eventId,
          businessId: event.businessId,
        })
        return
      }

      const message = buildWhatsAppMessage(event)
      const cronSecret = process.env.CRON_SECRET

      if (!cronSecret) {
        logger.warn('NOTIFICATION-SVC', 'CRON_SECRET not set — WhatsApp skipped', { eventId: event.eventId })
        return
      }

      const { error } = await this.supabase.functions.invoke('whatsapp-service', {
        body: {
          to:           ownerPhone,
          clientName:   event.clientName,
          businessName: 'tu negocio',  // fallback — template override
          date:         event.date,
          time:         event.time,
          message,
          template:     'appointment_reminder',
        },
        headers: {
          'x-internal-secret': cronSecret,
        },
      })

      if (error) {
        logger.warn('NOTIFICATION-SVC', 'WhatsApp edge function error', {
          eventId: event.eventId,
          error:   error.message,
        })
        return
      }

      logger.info('NOTIFICATION-SVC', 'WhatsApp notification sent', {
        eventId:    event.eventId,
        eventType:  event.type,
        businessId: event.businessId,
      })
    } catch (err) {
      logger.warn('NOTIFICATION-SVC', 'sendWhatsAppNotification threw (non-critical)', {
        eventId:    event.eventId,
        businessId: event.businessId,
        err,
      })
    }
  }

  // ── Private: Resolve owner phone ──────────────────────────────────────────────

  /**
   * Obtiene el teléfono del owner del negocio desde public.users.
   * Retorna null si no está disponible — la notificación de WA se omite.
   */
  private async getOwnerPhone(businessId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .select('phone')
        .eq('business_id', businessId)
        .eq('role', 'owner')
        .maybeSingle()

      if (error || !data) return null

      // Narrow the phone type — could be string | null depending on schema
      const phone = (data as { phone?: string | null }).phone
      return phone ?? null
    } catch {
      return null
    }
  }
}
