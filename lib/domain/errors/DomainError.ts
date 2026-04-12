/**
 * DomainError — Typed error class for domain-level failures.
 *
 * Exposes:
 *  - code:    machine-readable error identifier
 *  - message: human-readable description
 *  - cause:   original error (optional)
 *
 * Guarantees: never wraps unknown data, always typed.
 * Does not expose: infrastructure details (e.g. Supabase error codes).
 */

export type DomainErrorCode =
  // Appointment errors
  | 'APPOINTMENT_NOT_FOUND'
  | 'APPOINTMENT_CREATE_FAILED'
  | 'APPOINTMENT_UPDATE_FAILED'
  | 'APPOINTMENT_CANCEL_FAILED'
  | 'APPOINTMENT_CONFLICT'
  // Client errors
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_CREATE_FAILED'
  | 'CLIENT_FETCH_FAILED'
  // Service errors
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_CREATE_FAILED'
  | 'SERVICE_UPDATE_FAILED'
  | 'SERVICE_DELETE_FAILED'
  | 'SERVICE_FETCH_FAILED'
  // Finance errors
  | 'TRANSACTION_CREATE_FAILED'
  | 'TRANSACTION_FETCH_FAILED'
  | 'EXPENSE_CREATE_FAILED'
  | 'EXPENSE_FETCH_FAILED'
  // Notification errors
  | 'NOTIFICATION_CREATE_FAILED'
  | 'NOTIFICATION_FETCH_FAILED'
  | 'NOTIFICATION_UPDATE_FAILED'
  // Generic
  | 'UNKNOWN_ERROR'

export class DomainError extends Error {
  public readonly code: DomainErrorCode
  public readonly cause?: unknown

  constructor(code: DomainErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.cause = cause
  }

  /**
   * Creates a DomainError from an unknown caught value.
   */
  static from(code: DomainErrorCode, err: unknown): DomainError {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred'
    return new DomainError(code, message, err)
  }
}
