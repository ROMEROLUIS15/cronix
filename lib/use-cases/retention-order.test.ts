/**
 * retention-order.test.ts — the order businesses get the shared daily win-back budget.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §2 (topes diarios).
 * The order rotates every day so that, when the platform budget is not enough for
 * every business, it is not always the same businesses left without sending.
 */

import { describe, expect, it } from 'vitest'
import { orderBusinessesForDay } from './retention-order'

const IDS = ['c', 'a', 'd', 'b']

describe('orderBusinessesForDay', () => {
  it('returns every business exactly once', () => {
    const order = orderBusinessesForDay(IDS, new Date('2026-11-23T14:00:00Z'))
    expect([...order].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not depend on the order the ids arrive in', () => {
    const day = new Date('2026-11-23T14:00:00Z')
    expect(orderBusinessesForDay(['d', 'c', 'b', 'a'], day)).toEqual(orderBusinessesForDay(IDS, day))
  })

  it('is the same all day long', () => {
    expect(orderBusinessesForDay(IDS, new Date('2026-11-23T00:00:01Z')))
      .toEqual(orderBusinessesForDay(IDS, new Date('2026-11-23T23:59:59Z')))
  })

  it('puts a different business first on consecutive days, and every one gets a turn', () => {
    const firsts = [23, 24, 25, 26].map((d) => orderBusinessesForDay(IDS, new Date(`2026-11-${d}T14:00:00Z`))[0])
    expect(new Set(firsts).size).toBe(4)
  })

  it('handles no businesses', () => {
    expect(orderBusinessesForDay([], new Date('2026-11-23T14:00:00Z'))).toEqual([])
  })
})
