/**
 * Domain Repositories Barrel — re-exports all repository interfaces.
 *
 * CQRS: IAppointmentRepository is split into query/command sides.
 * New code should depend on IAppointmentQueryRepository or
 * IAppointmentCommandRepository directly for tighter coupling.
 *
 * This allows importing from '@/lib/domain/repositories' directly
 * instead of littering the codebase with per-file interface paths.
 */

export type { IAppointmentRepository, CreateAppointmentPayload, AppointmentDateRange, DashboardStats, AiApptRow } from './IAppointmentRepository'
export type { IAppointmentQueryRepository } from './IAppointmentQueryRepository'
export type { IAppointmentCommandRepository } from './IAppointmentCommandRepository'
export type { IClientRepository, ClientForSelect, ClientForAI, InsertClientPayload } from './IClientRepository'
export type { IServiceRepository } from './IServiceRepository'
export type { IFinanceRepository } from './IFinanceRepository'
export type { INotificationRepository, CreateNotificationPayload } from './INotificationRepository'
export type { IUserRepository, BusinessContext, TeamMember, CreateEmployeePayload } from './IUserRepository'
export type { IBusinessRepository } from './IBusinessRepository'
export type { IReminderRepository, PendingReminderRow } from './IReminderRepository'
