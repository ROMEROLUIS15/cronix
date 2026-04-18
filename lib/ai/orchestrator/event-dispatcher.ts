/**
 * event-dispatcher.ts — Dispatcher de eventos de citas.
 *
 * Responsabilidad ÚNICA: emitir un AppointmentEvent al NotificationService
 * de forma fire-and-forget, sin bloquear el flujo principal del orquestador.
 *
 * Garantías:
 *   - Nunca lanza excepciones al caller
 *   - Nunca bloquea (no await)
 *   - Errores se logean como warnings — no son críticos
 *
 * El orquestador opera con éxito independientemente del resultado de las notificaciones.
 */

import type { AppointmentEvent } from './events'
import type { INotificationService } from '@/lib/notifications/notification-service'
import { logger } from '@/lib/logger'

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Emite un evento al NotificationService de forma fire-and-forget.
 *
 * NO usar await sobre esta función — el caller debe continuar
 * su ejecución sin esperar el resultado de las notificaciones.
 *
 * @param event   - El evento a emitir (debe tener eventId único)
 * @param service - El NotificationService que procesará el evento
 */
export function emitEvent(
  event: AppointmentEvent,
  service: INotificationService,
): void {
  // void: explícito — no retornamos la Promise al caller
  void service.handle(event).catch((err: unknown) => {
    // Captura silenciosa: las notificaciones son derivadas, nunca críticas.
    // El booking ya fue completado. Este error no debe propagarse.
    logger.warn('EVENT-DISPATCHER', 'Notification pipeline failed (non-critical)', {
      eventId:   event.eventId,
      eventType: event.type,
      businessId: event.businessId,
      err,
    })
  })
}
