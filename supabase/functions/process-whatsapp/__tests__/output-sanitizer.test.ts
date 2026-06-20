/**
 * output-sanitizer.test.ts — client-output guards.
 * Locks that leaked tool markers for ALL three write tools are stripped/detected,
 * not just CONFIRM_ (a CANCEL_/RESCHEDULE_ leak used to slip through to the client).
 */

import { describe, it, expect } from 'vitest'
import { sanitizeOutput, containsInternalSyntax } from '../output-sanitizer.ts'

describe('sanitizeOutput — strips bracketed tool markers for all write tools', () => {
  it('strips [CONFIRM_BOOKING]', () => {
    expect(sanitizeOutput('Listo [CONFIRM_BOOKING] gracias')).toBe('Listo gracias')
  })
  it('strips [CANCEL_BOOKING]', () => {
    expect(sanitizeOutput('Hecho [CANCEL_BOOKING] ok')).toBe('Hecho ok')
  })
  it('strips [RESCHEDULE_BOOKING]', () => {
    expect(sanitizeOutput('Vale [RESCHEDULE_BOOKING] ya')).toBe('Vale ya')
  })
})

describe('containsInternalSyntax — detects markers for all write tools', () => {
  it('detects a CANCEL_ marker leak', () => {
    expect(containsInternalSyntax('algo CANCEL_BOOKING raro')).toBe(true)
  })
})
