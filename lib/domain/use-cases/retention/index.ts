/**
 * index.ts — Barrel exports for the retention / win-back use cases.
 */

export { GetEligibleClientsUseCase } from './GetEligibleClientsUseCase'
export { ProcessRetentionUseCase } from './ProcessRetentionUseCase'

export {
  RETENTION_DEFAULTS,
} from './types'

export type {
  GetEligibleClientsInput,
  EligibleClient,
  ProcessRetentionInput,
  ProcessRetentionResult,
  SendWinbackParams,
  IRetentionMessenger,
} from './types'
