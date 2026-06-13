/**
 * date-intent-seam.test.ts — Seam between each capability's fast-path and the
 * shared date parser. The parser defaults to "future" (correct for booking),
 * but agenda QUERIES can be about the past ("qué citas tuve el 9 de mayo").
 * The bug: list-appointments inherited the future-only assumption and rolled a
 * recently-passed day+month into NEXT year, so past-date queries returned
 * "no hay citas" even though the appointments existed.
 *
 * This locks the per-capability intent: read queries resolve to the NEAREST
 * occurrence; write capabilities keep rolling forward. If a future refactor
 * drops the `prefer` argument on either side, these fail.
 */

import { describe, it, expect } from 'vitest'
import { detectListAppointments } from '../capabilities/list-appointments/fast-path.ts'
import { detectCancel } from '../capabilities/cancel/fast-path.ts'

// Anchor: 2026-05-13 (Wednesday). May 9 is 4 days in the past; May 20 upcoming.
const TODAY = '2026-05-13'

describe('date-intent seam — agenda query (list-appointments) resolves nearest', () => {
  it('past day+month → this year (the recent past), not next year', () => {
    // The reported bug: "qué citas tuve el 9 de junio" returned nothing.
    expect(detectListAppointments('qué citas tuve el 9 de mayo', TODAY)?.date).toBe('2026-05-09')
  })

  it('upcoming day+month → stays this year', () => {
    expect(detectListAppointments('qué citas tengo el 20 de mayo', TODAY)?.date).toBe('2026-05-20')
  })

  it('relative keyword still resolves ("hoy")', () => {
    expect(detectListAppointments('qué citas tengo hoy', TODAY)?.date).toBe('2026-05-13')
  })

  it('DD/MM past form also resolves to this year', () => {
    expect(detectListAppointments('qué citas tuve el 9/5', TODAY)?.date).toBe('2026-05-09')
  })
})

describe('date-intent seam — write capability (cancel) keeps future intent', () => {
  it('a passed day+month rolls into next year for a write, not nearest', () => {
    // Same date string, opposite capability: cancel must NOT inherit "nearest".
    const args = detectCancel('cancela la cita de Ana del 9 de mayo', TODAY, null)
    expect(args?.client_name).toBe('ana')
    expect(args?.date).toBe('2027-05-09')
  })
})
