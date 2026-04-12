/**
 * IAppointmentRepository — Domain contract for appointment persistence.
 *
 * CQRS: This interface extends both IAppointmentQueryRepository and
 * IAppointmentCommandRepository. New code should depend on the specific
 * side it needs (query or command) for tighter coupling.
 *
 * Exposes: all appointment read/write operations the system requires.
 * Does not expose: Supabase, HTTP, or any infrastructure detail.
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { AppointmentWithRelations, SlotCheckAppointment } from '@/types'
import type { IAppointmentQueryRepository } from './IAppointmentQueryRepository'
import type { IAppointmentCommandRepository } from './IAppointmentCommandRepository'

// Re-export types that consumers depend on (defined in query/command files)
export type {
  CreateAppointmentPayload,
  AiApptRow,
  AppointmentDateRange,
  DashboardStats,
} from './IAppointmentQueryRepository'

/**
 * Legacy combined interface — extends both CQRS sides for backward compatibility.
 */
export interface IAppointmentRepository
  extends IAppointmentQueryRepository,
            IAppointmentCommandRepository {}
