/**
 * retention-days.test.ts — the number of days the owner types for win-back.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §3 (UX de activación).
 * No default is assumed: the owner must type a whole number from 1 to 365.
 */

import { describe, expect, it } from 'vitest'
import { parseRetentionDays, RETENTION_DAYS_MAX, RETENTION_DAYS_MIN } from './retention-days'

describe('parseRetentionDays', () => {
  it.each([['15', 15], ['20', 20], ['25', 25], ['1', 1], ['365', 365], [' 30 ', 30]])(
    'accepts %j as %i days',
    (raw, days) => {
      expect(parseRetentionDays(raw)).toBe(days)
    },
  )

  it.each(['', '   ', '0', '-5', '366', '15.5', '1e2', 'abc', '15días'])(
    'refuses %j (nothing is sent until the owner types a valid number)',
    (raw) => {
      expect(parseRetentionDays(raw)).toBeNull()
    },
  )

  it('documents the allowed range', () => {
    expect([RETENTION_DAYS_MIN, RETENTION_DAYS_MAX]).toEqual([1, 365])
  })
})
