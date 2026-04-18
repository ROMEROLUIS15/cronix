/**
 * events.ts — Tipos de eventos del sistema de citas.
 *
 * Responsabilidad ÚNICA: definir el contrato de los eventos
 * que el sistema puede emitir tras una acción exitosa.
 *
 * No contiene lógica — solo tipos puros.
 */

// ── Event Types ───────────────────────────────────────────────────────────────

export type AppointmentEventType =
  | 'appointment.created'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'

// ── Structured booking data ───────────────────────────────────────────────────
// Retornada por write-tools (confirm/cancel/reschedule) como `data` estructurada.
// Elimina dependencia de string parsing / regex para construir AppointmentEvent.

export interface BookingEventData {
  /** ID de la cita afectada (para trazabilidad) */
  appointmentId: string
  /** Nombre legible del cliente */
  clientName: string
  /** Nombre del servicio */
  serviceName: string
  /** Fecha en formato YYYY-MM-DD */
  date: string
  /** Hora en formato HH:mm (24h) */
  time: string
  /** Acción ejecutada */
  action: 'created' | 'cancelled' | 'rescheduled'
}

// ── Event Payload ─────────────────────────────────────────────────────────────

export interface AppointmentEvent {
  /**
   * Identificador único del evento generado con crypto.randomUUID().
   *
   * Garantiza idempotencia en toda la cadena de notificaciones:
   *   - Deduplicación per-request en ExecutionEngine (Set<string>)
   *   - Deduplicación persistent en NotificationService (check en DB)
   *
   * Un eventId solo puede generar UNA notificación en todo el sistema.
   */
  eventId: string

  /** Tipo de acción ejecutada */
  type: AppointmentEventType

  /** ID del negocio dueño de la cita (multi-tenant isolation) */
  businessId: string

  // ── Datos de la cita ───────────────────────────────────────────────────────
  // Extraídos del result string del RealToolExecutor.
  // Se usan para construir el mensaje de notificación.

  clientName: string
  serviceName: string

  /** Fecha en formato YYYY-MM-DD */
  date: string

  /** Hora en formato HH:mm (24h) */
  time: string

  // ── Contexto de origen ─────────────────────────────────────────────────────

  /** ID del usuario que disparó la acción (owner, employee, external) */
  userId: string

  /** Canal desde el que se originó la acción */
  channel: 'web' | 'whatsapp'
}
