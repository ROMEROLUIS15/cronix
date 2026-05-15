import { describe, it, expect } from 'vitest'
import { parseTimeExpression, userMentionedTime } from '../time-parser.ts'

describe('parseTimeExpression — digit forms', () => {
  it('"9:30" → 09:30', () => {
    expect(parseTimeExpression('agéndame a las 9:30')?.time).toBe('09:30')
  })
  it('"15:00" → 15:00', () => {
    expect(parseTimeExpression('agéndame a las 15:00')?.time).toBe('15:00')
  })
  it('"15h" → 15:00', () => {
    expect(parseTimeExpression('agéndame a las 15h')?.time).toBe('15:00')
  })
})

describe('parseTimeExpression — am/pm', () => {
  it('"a las 3pm" → 15:00', () => {
    expect(parseTimeExpression('a las 3pm')?.time).toBe('15:00')
  })
  it('"a las 3 p.m." → 15:00', () => {
    expect(parseTimeExpression('a las 3 p.m.')?.time).toBe('15:00')
  })
  it('"a las 9 am" → 09:00', () => {
    expect(parseTimeExpression('a las 9 am')?.time).toBe('09:00')
  })
  it('"a las 12 pm" stays 12 (noon)', () => {
    expect(parseTimeExpression('a las 12 pm')?.time).toBe('12:00')
  })
  it('"a las 12 am" → 00:00 (midnight)', () => {
    expect(parseTimeExpression('a las 12 am')?.time).toBe('00:00')
  })
})

describe('parseTimeExpression — Spanish franja', () => {
  it('"a las 3 de la tarde" → 15:00', () => {
    expect(parseTimeExpression('a las 3 de la tarde')?.time).toBe('15:00')
  })
  it('"a las 9 de la mañana" → 09:00', () => {
    expect(parseTimeExpression('a las 9 de la mañana')?.time).toBe('09:00')
  })
  it('"a las 8 de la noche" → 20:00', () => {
    expect(parseTimeExpression('a las 8 de la noche')?.time).toBe('20:00')
  })
  it('"mediodía" → 12:00', () => {
    expect(parseTimeExpression('agéndame al mediodía')?.time).toBe('12:00')
  })
  it('"medianoche" → 00:00', () => {
    expect(parseTimeExpression('a medianoche')?.time).toBe('00:00')
  })
})

describe('parseTimeExpression — word numerals', () => {
  it('"a las tres de la tarde" → 15:00', () => {
    expect(parseTimeExpression('a las tres de la tarde')?.time).toBe('15:00')
  })
  it('"a las nueve de la mañana" → 09:00', () => {
    expect(parseTimeExpression('a las nueve de la mañana')?.time).toBe('09:00')
  })
  it('"a las nueve y media" → 09:30', () => {
    expect(parseTimeExpression('a las nueve y media')?.time).toBe('09:30')
  })
  it('"a las nueve y cuarto" → 09:15', () => {
    expect(parseTimeExpression('a las nueve y cuarto')?.time).toBe('09:15')
  })
})

describe('parseTimeExpression — heuristic PM for bare 1-7', () => {
  it('"a las 3" alone → 15:00 (PM assumption)', () => {
    expect(parseTimeExpression('a las 3')?.time).toBe('15:00')
  })
  it('"a las 5" alone → 17:00 (PM assumption)', () => {
    expect(parseTimeExpression('a las 5')?.time).toBe('17:00')
  })
  it('"a las 8" alone stays morning (>=8)', () => {
    expect(parseTimeExpression('a las 8')?.time).toBe('08:00')
  })
  it('bare number without "a las" or franja → null', () => {
    expect(parseTimeExpression('tengo 3 servicios')).toBeNull()
  })
})

describe('userMentionedTime', () => {
  it('text with explicit time → true', () => {
    expect(userMentionedTime('agéndame a las 3pm')).toBe(true)
  })
  it('text without any time → false', () => {
    expect(userMentionedTime('agéndame a gardi mañana')).toBe(false)
  })
  it('text with "9:30" → true', () => {
    expect(userMentionedTime('mañana 9:30')).toBe(true)
  })
  it('text with "mediodía" → true', () => {
    expect(userMentionedTime('para el mediodía')).toBe(true)
  })
  it('bare number → false', () => {
    expect(userMentionedTime('tengo 3 servicios')).toBe(false)
  })
})
