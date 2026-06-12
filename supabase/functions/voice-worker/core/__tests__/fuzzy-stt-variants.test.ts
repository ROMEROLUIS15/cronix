/**
 * Regression: the owner asked for "Gardiana" (registered as "Gardi") and the
 * agent answered "No tengo a guardiana entre tus clientes" — desktop STT had
 * snapped the rare name onto the dictionary word "guardiana", which neither
 * the literal-prefix bridge ("guar" ≠ "gard") nor the old phonetic key could
 * recover. Also locks the generic-token guard: "gardiana cliente" used to hit
 * the exact-token tier against "Adriana Cliente" at 0.90 — above the WRITE
 * threshold — via the descriptor word "cliente" alone.
 */
import { describe, it, expect } from 'vitest'
import { fuzzyFind, phoneticKey } from '../fuzzy.ts'

const ROSTER = [
  'Ada Monsalve', 'Adri Venezuela', 'Adriana Cliente', 'Ailyn', 'Alan Romero',
  'Daniela Albornoz', 'Erika Meza', 'Estefani Sulbaran', 'Gabriela Avendaño',
  'Gardi', 'Girling', 'Glaimar Gutiérrez', 'Grace cruz', 'Lisset', 'Lisette',
  'Luis Romero', 'Mayela Cliente', 'Michelle Fernández', 'Paola Pérez Cliente',
  'Yoselen Alarcon Cliente', 'Zulay Avendaño',
].map(name => ({ name }))

describe('fuzzy — STT dictionary-word snap (Gardiana → guardiana → Gardi)', () => {
  it('"gardiana" → Gardi (literal prefix)', () => {
    const r = fuzzyFind(ROSTER, 'gardiana')
    expect(r.status).toBe('found')
    expect(r.match?.name).toBe('Gardi')
  })
  it('"guardiana" → Gardi (phonetic gu→g prefix)', () => {
    const r = fuzzyFind(ROSTER, 'guardiana')
    expect(r.status).toBe('found')
    expect(r.match?.name).toBe('Gardi')
  })
  it('"Guardiana" capitalized → Gardi', () => {
    expect(fuzzyFind(ROSTER, 'Guardiana').match?.name).toBe('Gardi')
  })
  it('phoneticKey drops silent/semi-silent u after g', () => {
    expect(phoneticKey('guardiana')).toBe('gardiana')
    expect(phoneticKey('miguel')).toBe('migel')
  })
  it('gu→g does not bridge unrelated names', () => {
    expect(fuzzyFind(ROSTER, 'guillermina').status).toBe('not_found')
  })
})

describe('fuzzy — generic descriptor tokens never grant exact-token tier', () => {
  it('"gardiana cliente" → Gardi, NOT Adriana Cliente', () => {
    const r = fuzzyFind(ROSTER, 'gardiana cliente')
    expect(r.status).toBe('found')
    expect(r.match?.name).toBe('Gardi')
  })
  it('"la señora gardiana" tokens → still Gardi', () => {
    expect(fuzzyFind(ROSTER, 'señora gardiana').match?.name).toBe('Gardi')
  })
  it('registered names keep matching via their real token', () => {
    const r = fuzzyFind(ROSTER, 'adriana')
    expect(r.status).toBe('found')
    expect(r.match?.name).toBe('Adriana Cliente')
  })
})
