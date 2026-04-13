/**
 * DomainError — Unit Tests
 *
 * Tests for lib/domain/errors/DomainError.ts
 */
import { describe, it, expect } from 'vitest'

import { DomainError, type DomainErrorCode } from '@/lib/domain/errors/DomainError'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DomainError', () => {
  it('creates error with code and message', () => {
    const code: DomainErrorCode = 'APPOINTMENT_NOT_FOUND'
    const err = new DomainError(code, 'Resource not found')

    expect(err.code).toBe(code)
    expect(err.message).toBe('Resource not found')
    expect(err.name).toBe('DomainError')
  })

  it('supports multiple error codes', () => {
    const codes: DomainErrorCode[] = [
      'APPOINTMENT_NOT_FOUND',
      'APPOINTMENT_CONFLICT',
      'CLIENT_NOT_FOUND',
      'SERVICE_NOT_FOUND',
      'TRANSACTION_CREATE_FAILED',
      'UNKNOWN_ERROR',
    ]

    for (const code of codes) {
      const err = new DomainError(code, `Test: ${code}`)
      expect(err.code).toBe(code)
    }
  })

  it('is instance of Error', () => {
    const err = new DomainError('UNKNOWN_ERROR', 'test')
    expect(err).toBeInstanceOf(Error)
  })

  it('includes stack trace', () => {
    const err = new DomainError('UNKNOWN_ERROR', 'test')
    expect(err.stack).toBeDefined()
    expect(typeof err.stack).toBe('string')
  })

  it('stores optional cause', () => {
    const original = new Error('original')
    const err = DomainError.from('APPOINTMENT_CREATE_FAILED', original)

    expect(err.cause).toBe(original)
    expect(err.message).toBe('original')
  })
})
