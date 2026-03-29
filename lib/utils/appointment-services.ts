/**
 * Appointment Services Adapter — Normalizes single/multi-service data.
 *
 * All UI components should use these helpers instead of accessing
 * `apt.service` or `apt.appointment_services` directly.
 * This is the single migration point when `service_id` is eventually dropped.
 */

import type { AppointmentService, AppointmentServiceJunction } from '@/types'

interface AppointmentWithServices {
  service?: AppointmentService | null
  appointment_services?: AppointmentServiceJunction[]
}

/** Returns the ordered list of services for an appointment. */
export function getServices(apt: AppointmentWithServices): AppointmentService[] {
  if (apt.appointment_services?.length) {
    return apt.appointment_services
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(as => as.service)
      .filter(Boolean)
  }
  return apt.service ? [apt.service] : []
}

/** Returns the primary (first) service color, or fallback. */
export function getPrimaryColor(apt: AppointmentWithServices): string {
  const services = getServices(apt)
  return services[0]?.color ?? '#ccc'
}

/** Returns comma-joined service names. */
export function getServiceNames(apt: AppointmentWithServices): string {
  return getServices(apt).map(s => s.name).join(', ') || 'Sin servicio'
}

/** Returns the total duration in minutes. */
export function getTotalDuration(apt: AppointmentWithServices): number {
  return getServices(apt).reduce((sum, s) => sum + s.duration_min, 0)
}

/** Returns the total price. */
export function getTotalPrice(apt: AppointmentWithServices): number {
  return getServices(apt).reduce((sum, s) => sum + s.price, 0)
}

/** Computes total duration from a list of services. */
export function sumDuration(services: AppointmentService[]): number {
  return services.reduce((sum, s) => sum + s.duration_min, 0)
}

/** Computes total price from a list of services. */
export function sumPrice(services: AppointmentService[]): number {
  return services.reduce((sum, s) => sum + s.price, 0)
}
