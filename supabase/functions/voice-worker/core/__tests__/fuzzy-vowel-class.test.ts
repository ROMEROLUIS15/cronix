/**
 * Eval suite for the vowel-class phonetic equivalence — the general fix for
 * the "digo Yuseli y me consigue Joselyn/Yoselin" class of bug.
 *
 * These cases are deliberately GENERIC (invented names, not one business's
 * roster): the property under test is that Spanish STT vowel confusion
 * (i↔e, o↔u) bridges variants of the SAME name for ANY name, while consonant
 * differences and the `a` vowel keep distinct names distinct. New clients
 * register with unpredictable names; this measures the algorithm, not a list.
 */

import { describe, it, expect } from 'vitest'
import { fuzzyFind, vowelClassKey } from '../fuzzy.ts'

const c = (name: string) => ({ name })

describe('vowelClassKey — i↔e and o↔u collapse, a and consonants stay', () => {
  it('o↔u variants share a key', () => {
    expect(vowelClassKey('yuseli')).toBe(vowelClassKey('yoseli'))
    expect(vowelClassKey('yusmary')).toBe(vowelClassKey('yosmary'))
  })
  it('i↔e variants share a key', () => {
    expect(vowelClassKey('marielis')).toBe(vowelClassKey('marieles'))
  })
  it('a stays distinct from o (NOT merged)', () => {
    expect(vowelClassKey('marcela')).not.toBe(vowelClassKey('marcelo'))
  })
  it('consonant differences stay distinct', () => {
    expect(vowelClassKey('karina')).not.toBe(vowelClassKey('katina')) // r vs t
    expect(vowelClassKey('pedro')).not.toBe(vowelClassKey('petro'))   // d vs t
    expect(vowelClassKey('lizeth')).not.toBe(vowelClassKey('lisbeth'))// b survives
  })
})

describe('fuzzyFind — vowel variants resolve to the one registered client', () => {
  it('STT "Yoseli" → the registered "Yuseli" (the reported bug)', () => {
    const out = fuzzyFind([c('Yuseli Mendoza'), c('Joselyn Saavedra')], 'yoseli')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Yuseli Mendoza')
  })
  it('STT "Yosmary" → registered "Yusmary Rangel"', () => {
    const out = fuzzyFind([c('Yusmary Rangel')], 'yosmary')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Yusmary Rangel')
  })
  it('STT "Marieles" → registered "Marielis Soto"', () => {
    const out = fuzzyFind([c('Marielis Soto')], 'marieles')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Marielis Soto')
  })
  it('the very different name is NOT a candidate (no cross-name)', () => {
    const out = fuzzyFind([c('Yuseli Mendoza'), c('Joselyn Saavedra')], 'yoseli')
    expect(out.candidates?.some(x => x.name === 'Joselyn Saavedra')).toBe(false)
  })
})

describe('fuzzyFind — precision held under vowel tolerance', () => {
  it('distinct consonant pair stays separate (Karina vs Katina)', () => {
    const db = [c('Karina López'), c('Katina Ruiz')]
    expect(fuzzyFind(db, 'karina').match?.name).toBe('Karina López')
    expect(fuzzyFind(db, 'katina').match?.name).toBe('Katina Ruiz')
  })
  it('a↔o kept distinct (Marcelo vs Marcela are different people)', () => {
    const db = [c('Marcelo Díaz'), c('Marcela Díaz')]
    expect(fuzzyFind(db, 'marcelo').match?.name).toBe('Marcelo Díaz')
    expect(fuzzyFind(db, 'marcela').match?.name).toBe('Marcela Díaz')
  })
  it('a truly unrelated name is rejected', () => {
    expect(fuzzyFind([c('Yuseli Mendoza')], 'carlos').status).toBe('not_found')
  })
})

describe('fuzzyFind — two real vowel-variant clients → ask, never silently pick', () => {
  it('"yuseli" with BOTH Yuseli and Yoseli registered → ambiguous', () => {
    const out = fuzzyFind([c('Yuseli Mendoza'), c('Yoseli Rangel')], 'yuseli')
    // Both are vowel-exact to the query; the matcher must surface both and let
    // the agent ask, not gamble on the wrong client.
    expect(out.status).toBe('ambiguous')
    expect(out.candidates?.length).toBe(2)
  })
})
