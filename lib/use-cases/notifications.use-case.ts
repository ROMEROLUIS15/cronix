/**
 * Notifications Use Case — Business logic for in-app notification events.
 *
 * Handles notification creation for:
 *  - Appointment creation/confirmation
 *  - Appointment status changes
 *  - Cron reminder execution
 *  - WhatsApp delivery failures
 *
 * Pure business logic — receives data, returns notification payloads.
 */

import type { CreateNotificationInput } from '@/lib/repositories/notifications.repo'

// ── Types ──────────────────────────────────────────────────────────────────

export type NotificationEventType =
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.confirmed'
  | 'appointment.cancelled'
  | 'reminder.sent'
  | 'whatsapp.failed'
  | 'whatsapp.sent'

// ── Appointment Notifications ──────────────────────────────────────────────

export function notificationForAppointmentCreated(
  businessId: string,
  clientName: string,
  serviceName: string,
  appointmentTime: string
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: '✓ Nueva cita agendada',
    content: `${clientName} • ${serviceName} a las ${appointmentTime}`,
    type: 'success',
    metadata: {
      event: 'appointment.created',
      clientName,
      serviceName,
    },
  }
}

export function notificationForAppointmentConfirmed(
  businessId: string,
  clientName: string,
  serviceName: string,
  appointmentTime: string
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: '✓ Cita confirmada por cliente',
    content: `${clientName} confirmó su cita de ${serviceName} a las ${appointmentTime}`,
    type: 'success',
    metadata: {
      event: 'appointment.confirmed',
      clientName,
    },
  }
}

export function notificationForAppointmentCancelled(
  businessId: string,
  clientName: string,
  serviceName: string,
  reason?: string
): CreateNotificationInput {
  const reasonText = reason ? ` — ${reason}` : ''
  return {
    business_id: businessId,
    title: '⚠ Cita cancelada',
    content: `${clientName} • ${serviceName}${reasonText}`,
    type: 'warning',
    metadata: {
      event: 'appointment.cancelled',
      clientName,
      reason,
    },
  }
}

export function notificationForUnconfirmedAppointment(
  businessId: string,
  clientName: string,
  serviceName: string,
  daysUntil: number
): CreateNotificationInput {
  const daysText = daysUntil === 0 ? 'hoy' : `en ${daysUntil} día${daysUntil > 1 ? 's' : ''}`
  return {
    business_id: businessId,
    title: '⚠ Cita sin confirmar',
    content: `${clientName} aún no confirma su cita de ${serviceName} ${daysText}`,
    type: 'warning',
    metadata: {
      event: 'appointment.unconfirmed',
      clientName,
      daysUntil,
    },
  }
}

// ── Reminder Notifications ─────────────────────────────────────────────────

export interface ReminderSummary {
  totalAppointments: number
  appointmentsList: string
}

export function notificationForRemindersSent(
  businessId: string,
  summary: ReminderSummary
): CreateNotificationInput {
  const overflowText =
    summary.totalAppointments > 5
      ? `\n+${summary.totalAppointments - 5} más`
      : ''

  return {
    business_id: businessId,
    title: `📋 ${summary.totalAppointments} recordatorio${summary.totalAppointments > 1 ? 's' : ''} enviado${summary.totalAppointments > 1 ? 's' : ''}`,
    content: `${summary.appointmentsList}${overflowText}`,
    type: 'info',
    metadata: {
      event: 'reminder.sent',
      totalAppointments: summary.totalAppointments,
    },
  }
}

// ── WhatsApp Notifications ─────────────────────────────────────────────────

export function notificationForWhatsAppSent(
  businessId: string,
  clientName: string,
  successCount: number
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: '✓ Recordatorios WhatsApp enviados',
    content: `${successCount} recordatorio${successCount > 1 ? 's' : ''} enviado${successCount > 1 ? 's' : ''} a través de WhatsApp`,
    type: 'success',
    metadata: {
      event: 'whatsapp.sent',
      successCount,
    },
  }
}

export function notificationForWhatsAppFailed(
  businessId: string,
  clientName: string,
  serviceName: string,
  appointmentTime: string
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: '❌ Fallo al enviar recordatorio',
    content: `No se pudo enviar recordatorio a ${clientName} • ${serviceName} a las ${appointmentTime}`,
    type: 'error',
    metadata: {
      event: 'whatsapp.failed',
      clientName,
      serviceName,
    },
  }
}

export function notificationForMultipleWhatsAppFailures(
  businessId: string,
  failureCount: number
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: `❌ ${failureCount} recordatorio${failureCount > 1 ? 's' : ''} no enviado${failureCount > 1 ? 's' : ''}`,
    content: `No se pudieron entregar ${failureCount} recordatorio${failureCount > 1 ? 's' : ''} por WhatsApp. Verifica la configuración.`,
    type: 'error',
    metadata: {
      event: 'whatsapp.multiple_failed',
      failureCount,
    },
  }
}

// ── Client Notifications ───────────────────────────────────────────────────

export function notificationForNewClient(
  businessId: string,
  clientName: string,
  phone?: string
): CreateNotificationInput {
  const content = phone ? `${clientName} • ${phone}` : clientName
  return {
    business_id: businessId,
    title: '👤 Nuevo cliente agregado',
    content,
    type: 'success',
    metadata: {
      event: 'client.created',
      clientName,
    },
  }
}

// ── Client Confirmation/Cancellation (via WhatsApp) ─────────────────────────

export function notificationForClientConfirmedAppointment(
  businessId: string,
  clientName: string,
  serviceName: string,
  appointmentTime: string
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: '✓ Cliente confirmó su cita',
    content: `${clientName} • ${serviceName} a las ${appointmentTime}`,
    type: 'success',
    metadata: {
      event: 'client.confirmed_appointment',
      clientName,
    },
  }
}

export function notificationForClientCancelledAppointment(
  businessId: string,
  clientName: string,
  serviceName: string,
  appointmentTime: string
): CreateNotificationInput {
  return {
    business_id: businessId,
    title: '⚠ Cliente canceló su cita',
    content: `${clientName} • ${serviceName} a las ${appointmentTime}`,
    type: 'warning',
    metadata: {
      event: 'client.cancelled_appointment',
      clientName,
    },
  }
}
