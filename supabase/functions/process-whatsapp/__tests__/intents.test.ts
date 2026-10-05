/**
 * intents.test.ts — locks the single-source intent predicates (no more divergence).
 * Covers enclitics ("reagendarla") AND accented imperatives ("reagéndala") — the exact
 * forms that used to slip through (é ≠ e broke the stem; one copy matched, the other not).
 */

import { describe, it, expect } from 'vitest'
import { isCancelIntent, isCantAttendIntent, isRescheduleIntent, isManageExisting, isBookIntent } from '../intents.ts'

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

describe('isCantAttendIntent — the natural reply to a reminder', () => {
  it('matches "cannot attend" phrasings (accent-insensitive)', () => {
    for (const t of [
      'No podré asistir', 'no podre asistir a la cita', 'Hola, no puedo ir mañana', 'no puedo asistir',
      'no voy a poder ir', 'No voy a poder asistir, disculpe', 'no voy a poder', 'Lo siento, no podré.',
      'no asistiré', 'no iré', 'no podremos ir', 'no vamos a ir', 'no puedo llegar', 'no voy a poder acudir',
    ]) {
      expect(isCantAttendIntent(t), t).toBe(true)
    }
  })
  it('does not fire on lateness, other activities or unrelated negations', () => {
    for (const t of [
      'no voy a llegar a tiempo', 'no podré pagar en efectivo', 'no puedo pagar por transferencia',
      'quiero cancelar mi cita', 'sí, ahí estaré', 'no, gracias', 'no sé si pueda', 'irme temprano',
    ]) {
      expect(isCantAttendIntent(t), t).toBe(false)
    }
  })
  it('stays independent of the strict manage-existing predicate', () => {
    expect(isManageExisting('no podré asistir')).toBe(false)
    expect(isCancelIntent('no podré asistir')).toBe(false)
  })
})
