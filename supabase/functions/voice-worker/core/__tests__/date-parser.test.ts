import { describe, it, expect } from 'vitest'
import { parseDateExpression } from '../date-parser.ts'

// Anchor today to a fixed Wednesday so weekday math is verifiable.
// 2026-05-13 = Wednesday (DOW 3). Same week: Thu=14, Fri=15, Sat=16, Sun=17.
const TODAY = '2026-05-13'

describe('parseDateExpression — discrete keywords', () => {
  it('"hoy" → today', () => {
    expect(parseDateExpression('qué citas tengo hoy', TODAY)?.date).toBe('2026-05-13')
  })
  it('"mañana" → +1', () => {
    expect(parseDateExpression('agéndame mañana', TODAY)?.date).toBe('2026-05-14')
  })
  it('"pasado mañana" → +2 (matches before "mañana")', () => {
    expect(parseDateExpression('citas pasado mañana', TODAY)?.date).toBe('2026-05-15')
  })
  it('"ayer" → -1', () => {
    expect(parseDateExpression('quién vino ayer', TODAY)?.date).toBe('2026-05-12')
  })
  it('"anteayer" → -2 (matches before "ayer")', () => {
    expect(parseDateExpression('cita de anteayer', TODAY)?.date).toBe('2026-05-11')
  })
  it('accent-stripped "manana" still resolves', () => {
    expect(parseDateExpression('agendame manana', TODAY)?.date).toBe('2026-05-14')
  })
})

describe('parseDateExpression — relative expressions', () => {
  it('"en 3 días" → +3', () => {
    expect(parseDateExpression('en 3 días', TODAY)?.date).toBe('2026-05-16')
  })
  it('"dentro de 5 días" → +5', () => {
    expect(parseDateExpression('dentro de 5 días', TODAY)?.date).toBe('2026-05-18')
  })
  it('"en una semana" → +7', () => {
    expect(parseDateExpression('en una semana', TODAY)?.date).toBe('2026-05-20')
  })
  it('"dentro de dos semanas" → +14', () => {
    expect(parseDateExpression('dentro de dos semanas', TODAY)?.date).toBe('2026-05-27')
  })
  it('"en 1 mes" → +30', () => {
    expect(parseDateExpression('en 1 mes', TODAY)?.date).toBe('2026-06-12')
  })
  it('"en quince días" → +15', () => {
    expect(parseDateExpression('en quince días', TODAY)?.date).toBe('2026-05-28')
  })
})

describe('parseDateExpression — absolute "N de Mes"', () => {
  it('"el 21 de mayo" — current year', () => {
    expect(parseDateExpression('el 21 de mayo', TODAY)?.date).toBe('2026-05-21')
  })
  it('"21 de mayo" without leading article', () => {
    expect(parseDateExpression('agéndame 21 de mayo', TODAY)?.date).toBe('2026-05-21')
  })
  it('"el 9 de mayo" — already passed → next year', () => {
    expect(parseDateExpression('el 9 de mayo', TODAY)?.date).toBe('2027-05-09')
  })
  it('"el 5 de junio" — next month → current year', () => {
    expect(parseDateExpression('el 5 de junio', TODAY)?.date).toBe('2026-06-05')
  })
  it('"el 1 de enero" — already passed in calendar → next year', () => {
    expect(parseDateExpression('el 1 de enero', TODAY)?.date).toBe('2027-01-01')
  })
  it('"el 21 de mayo de 2027" — explicit year', () => {
    expect(parseDateExpression('el 21 de mayo de 2027', TODAY)?.date).toBe('2027-05-21')
  })
  it('"21 de mayo del 27" — two-digit year', () => {
    expect(parseDateExpression('21 de mayo del 27', TODAY)?.date).toBe('2027-05-21')
  })
  it('"para el 30 de septiembre"', () => {
    expect(parseDateExpression('para el 30 de septiembre', TODAY)?.date).toBe('2026-09-30')
  })
  it('alternative "setiembre" spelling', () => {
    expect(parseDateExpression('el 15 de setiembre', TODAY)?.date).toBe('2026-09-15')
  })
})

describe('parseDateExpression — DD/MM slash notation', () => {
  it('"21/05" → current year', () => {
    expect(parseDateExpression('agéndame 21/05', TODAY)?.date).toBe('2026-05-21')
  })
  it('"21-05" with hyphen', () => {
    expect(parseDateExpression('agéndame 21-05', TODAY)?.date).toBe('2026-05-21')
  })
  it('"21/05/2027" → full year', () => {
    expect(parseDateExpression('agéndame 21/05/2027', TODAY)?.date).toBe('2027-05-21')
  })
  it('"21/05/27" → 2027', () => {
    expect(parseDateExpression('agéndame 21/05/27', TODAY)?.date).toBe('2027-05-21')
  })
})

describe('parseDateExpression — weekdays', () => {
  it('"el viernes" from Wednesday → +2', () => {
    expect(parseDateExpression('el viernes', TODAY)?.date).toBe('2026-05-15')
  })
  it('"el próximo viernes" from Wednesday → +2', () => {
    expect(parseDateExpression('el próximo viernes', TODAY)?.date).toBe('2026-05-15')
  })
  it('"el siguiente lunes" from Wednesday → +5', () => {
    expect(parseDateExpression('para el siguiente lunes', TODAY)?.date).toBe('2026-05-18')
  })
  it('"el miércoles" from Wednesday → +7 (next week, never today)', () => {
    expect(parseDateExpression('el miércoles', TODAY)?.date).toBe('2026-05-20')
  })
  it('"para el sábado" → +3', () => {
    expect(parseDateExpression('para el sábado', TODAY)?.date).toBe('2026-05-16')
  })
  it('"el viernes que viene"', () => {
    expect(parseDateExpression('el viernes que viene', TODAY)?.date).toBe('2026-05-15')
  })
  it('accent-stripped "miercoles" still resolves', () => {
    expect(parseDateExpression('el miercoles', TODAY)?.date).toBe('2026-05-20')
  })
})

describe('parseDateExpression — bare "día N"', () => {
  it('"el día 20" → current month (May)', () => {
    expect(parseDateExpression('el día 20', TODAY)?.date).toBe('2026-05-20')
  })
  it('"día 5" → already passed → next month', () => {
    expect(parseDateExpression('agéndame el día 5', TODAY)?.date).toBe('2026-06-05')
  })
  it('"día 13" → today is day 13 → next month', () => {
    expect(parseDateExpression('agéndame día 13', TODAY)?.date).toBe('2026-05-13')
  })
})

describe('parseDateExpression — non-matches return null', () => {
  it('plain greeting', () => {
    expect(parseDateExpression('hola luis', TODAY)).toBeNull()
  })
  it('booking with no date', () => {
    expect(parseDateExpression('agéndame a maría', TODAY)).toBeNull()
  })
  it('time-only ("a las 3pm") returns null', () => {
    expect(parseDateExpression('agéndame a las 3 pm', TODAY)).toBeNull()
  })
  it('unrelated number ("3 servicios") does not match', () => {
    expect(parseDateExpression('tengo 3 servicios disponibles', TODAY)).toBeNull()
  })
})

describe('parseDateExpression — priority ordering', () => {
  it('"hoy" wins over weekday name in same sentence', () => {
    expect(parseDateExpression('hoy es miércoles', TODAY)?.reason).toBe('hoy')
  })
  it('"pasado mañana" wins over "mañana"', () => {
    expect(parseDateExpression('pasado mañana', TODAY)?.date).toBe('2026-05-15')
  })
  it('"anteayer" wins over "ayer"', () => {
    expect(parseDateExpression('vino anteayer', TODAY)?.date).toBe('2026-05-11')
  })
  it('"N de Mes" wins over bare "día N"', () => {
    const out = parseDateExpression('el 21 de mayo', TODAY)!
    expect(out.date).toBe('2026-05-21')
    expect(out.reason).toContain('mayo')
  })
})
