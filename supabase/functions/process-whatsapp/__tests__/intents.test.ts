/**
 * intents.test.ts — locks the single-source intent predicates (no more divergence).
 * Covers enclitics ("reagendarla") AND accented imperatives ("reagéndala") — the exact
 * forms that used to slip through (é ≠ e broke the stem; one copy matched, the other not).
 */

import { describe, it, expect } from 'vitest'
import { isCancelIntent, isRescheduleIntent, isManageExisting, isBookIntent } from '../intents.ts'

describe('intents — enclitic + accented forms match (accent-insensitive)', () => {
  it('isRescheduleIntent matches reschedule verbs incl. enclitics/accents', () => {
    for (const t of ['reagenda mi cita', 'reagéndala', 'quiero reagendarla', 'reprográmame', 'muévela', 'cambia la hora']) {
      expect(isRescheduleIntent(t)).toBe(true)
    }
  })
  it('isCancelIntent matches cancel verbs incl. accents', () => {
    for (const t of ['cancela mi cita', 'cancélala', 'anúlala', 'bórrala']) {
      expect(isCancelIntent(t)).toBe(true)
    }
  })
  it('isManageExisting is strict (no mover/cambiar) — used to exit new-booking', () => {
    expect(isManageExisting('reagéndala')).toBe(true)
    expect(isManageExisting('cancélala')).toBe(true)
    expect(isManageExisting('muévela')).toBe(false)   // ambiguous mid-booking
    expect(isManageExisting('cambia la hora')).toBe(false)
  })
  it('isBookIntent matches new-booking but NOT reschedule', () => {
    expect(isBookIntent('quiero agendar una cita')).toBe(true)
    expect(isBookIntent('nueva cita')).toBe(true)
    expect(isBookIntent('reagéndala')).toBe(false)
  })
})
