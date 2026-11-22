/**
 * whatsapp-error-codes.test.ts — which Meta send errors stop a whole win-back run.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §7 (send failures).
 * Source of the codes: Meta "WhatsApp error codes" reference.
 */

import { describe, it, expect } from 'vitest'
import { classifyMetaSendError } from '@/lib/services/whatsapp-error-codes'

describe('classifyMetaSendError', () => {
  it.each([
    [132000, 'template: parameter count mismatch'],
    [132001, 'template: does not exist in the language / not approved'],
    [132005, 'template: translated text too long'],
    [132007, 'template: policy violation'],
    [132012, 'template: parameter format mismatch'],
    [132015, 'template: paused for low quality'],
    [132016, 'template: permanently disabled'],
    [131042, 'account: payment method error'],
    [131048, 'account: sending restrictions on the phone number'],
    [130429, 'account: API throughput reached'],
    [190, 'account: access token expired'],
  ])('%i is platform-wide (%s)', (code) => {
    expect(classifyMetaSendError(code)).toBe('platform')
  })

  it.each([
    [131049, 'recipient: healthy-ecosystem limit'],
    [131050, 'recipient: opted out of marketing'],
    [131026, 'recipient: not reachable on WhatsApp'],
    [131047, 'recipient: outside the 24h window'],
    [131056, 'recipient: pair rate limit'],
  ])('%i affects only that recipient (%s)', (code) => {
    expect(classifyMetaSendError(code)).toBe('recipient')
  })

  it('treats a missing or unknown code as recipient-scoped (previous behavior)', () => {
    expect(classifyMetaSendError(null)).toBe('recipient')
    expect(classifyMetaSendError(undefined)).toBe('recipient')
    expect(classifyMetaSendError(999999)).toBe('recipient')
  })
})
