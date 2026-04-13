/**
 * Domain Error — Unit Tests
 *
 * Tests for lib/domain/errors/DomainError.ts
 */
import { describe, it, expect } from 'vitest'

import { DomainError } from '@/lib/domain/errors/DomainError'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DomainError', () => {
  it('creates error with code and message', () => {
    const err = new DomainError('NOT_FOUND', 'Resource not found')

    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Resource not found')
    expect(err.name).toBe('DomainError')
  })

  it('supports all known error codes', () => {
    const codes: Array<DomainError['code']> = [
      'NOT_FOUND',
      'DUPLICATE',
      'INVALID_STATE',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'VALIDATION',
      'CONFLICT',
    ]

    for (const code of codes) {
      const err = new DomainError(code, `Test: ${code}`)
      expect(err.code).toBe(code)
    }
  })

  it('is instance of Error', () => {
    const err = new DomainError('NOT_FOUND', 'test')
    expect(err).toBeInstanceOf(Error)
  })

  it('includes stack trace', () => {
    const err = new DomainError('NOT_FOUND', 'test')
    expect(err.stack).toBeDefined()
    expect(typeof err.stack).toBe('string')
  })
})
