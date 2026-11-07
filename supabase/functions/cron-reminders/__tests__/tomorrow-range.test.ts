/**
 * tomorrow-range.test.ts — "Tomorrow" for the 20:00 run is the business's local day.
 *
 * BUG (found 2026-11-07): the range used UTC midnights. In Caracas (UTC-4) it covered
 * 20:00 today to 20:00 tomorrow, so an appointment tomorrow from 20:00 never got its
 * reminder; in Mexico City (UTC-6) a late-afternoon one was missed, and once the late
 * reminder existed it was reminded twice (the next night, after the appointment).
 */

import { describe, it, expect } from 'vitest'
import { getTomorrowRange } from '../modules/tomorrow-range.ts'

describe('getTomorrowRange', () => {
  it.each([
    ['Caracas (UTC-4)', 'America/Caracas', '2026-11-07T00:00:05Z', '2026-11-07T04:00:00.000Z', '2026-11-08T04:00:00.000Z'],
    ['Mexico City (UTC-6)', 'America/Mexico_City', '2026-11-07T02:00:05Z', '2026-11-07T06:00:00.000Z', '2026-11-08T06:00:00.000Z'],
    ['Kolkata (UTC+5:30)', 'Asia/Kolkata', '2026-11-06T14:30:05Z', '2026-11-06T18:30:00.000Z', '2026-11-07T18:30:00.000Z'],
    ['UTC', 'UTC', '2026-11-06T20:00:05Z', '2026-11-07T00:00:00.000Z', '2026-11-08T00:00:00.000Z'],
    // DST ends overnight: tomorrow lasts 25 hours.
    ['Los Angeles, the night before DST ends', 'America/Los_Angeles', '2026-11-01T03:00:05Z', '2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z'],
    ['Madrid, the night before DST ends', 'Europe/Madrid', '2026-10-24T18:00:05Z', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
  ])('%s at its 20:00 → its own tomorrow', (_label, tz, now, start, end) => {
    expect(getTomorrowRange(tz, new Date(now))).toEqual({ start, end })
  })

  it('includes tomorrow at 20:30 in Caracas, which the UTC range left out', () => {
    const { start, end } = getTomorrowRange('America/Caracas', new Date('2026-11-07T00:00:05Z'))
    const tomorrowAt2030 = '2026-11-08T00:30:00.000Z'
    expect(tomorrowAt2030 >= start && tomorrowAt2030 < end).toBe(true)
  })

  it('leaves out today at 20:30 in Caracas, which the UTC range wrongly included', () => {
    const { start } = getTomorrowRange('America/Caracas', new Date('2026-11-07T00:00:05Z'))
    expect('2026-11-07T00:30:00.000Z' < start).toBe(true)
  })
})
