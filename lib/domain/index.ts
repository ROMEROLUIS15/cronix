/**
 * lib/domain/index.ts — Barrel export for the domain layer.
 *
 * Exposes: all domain contracts and error types.
 * Does not expose: infrastructure implementations.
 */

export { DomainError } from './errors/DomainError'
export type { DomainErrorCode } from './errors/DomainError'

export type { IAppointmentRepository, AiApptRow, AppointmentDateRange, DashboardStats, CreateAppointmentPayload } from './repositories/IAppointmentRepository'
export type { IClientRepository, ClientForSelect, ClientForAI, InsertClientPayload } from './repositories/IClientRepository'
export type { IServiceRepository, ServiceForDropdown, CreateServicePayload, UpdateServicePayload } from './repositories/IServiceRepository'
export type { IFinanceRepository, CreateTransactionPayload, CreateExpensePayload, RevenueDataPoint } from './repositories/IFinanceRepository'
export type { INotificationRepository, CreateNotificationPayload } from './repositories/INotificationRepository'
