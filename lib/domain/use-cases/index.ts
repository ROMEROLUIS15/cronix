/**
 * index.ts — Barrel exports for domain use cases.
 */

export { CreateAppointmentUseCase } from './CreateAppointmentUseCase'
export { CancelAppointmentUseCase } from './CancelAppointmentUseCase'
export { RescheduleAppointmentUseCase } from './RescheduleAppointmentUseCase'
export { GetAppointmentsByDateUseCase } from './GetAppointmentsByDateUseCase'
export { GetClientsUseCase } from './GetClientsUseCase'
export { RegisterPaymentUseCase } from './RegisterPaymentUseCase'

export type {
  CreateAppointmentInput,
  CreateAppointmentOutput,
  CancelAppointmentInput,
  RescheduleAppointmentInput,
  GetAppointmentsByDateInput,
  AppointmentSummary,
  GetClientsInput,
  ClientSummary,
  RegisterPaymentInput,
} from './types'
