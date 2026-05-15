import { describe, it, expect } from 'vitest'
import { fuzzyFind } from '../fuzzy.ts'

/**
 * Adversarial test harness — captures the actual matching contract,
 * not just the happy path. Each block names the real-world scenario that
 * motivated it; the prior C2.5 tightening regressed on the partial-first-
 * name case because the suite didn't cover it.
 */

interface Client { id: string; name: string }
const c = (id: string, name: string): Client => ({ id, name })

describe('fuzzyFind — partial-name queries (the Gardi regression)', () => {
  it('"gardi" → "Gardi Suárez" (exact-token first-name)', () => {
    const out = fuzzyFind([c('1', 'Gardi Suárez')], 'gardi')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Gardi Suárez')
  })
  it('"pedro" → "Pedro Pérez" (exact-token first-name)', () => {
    const out = fuzzyFind([c('1', 'Pedro Pérez')], 'pedro')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Pedro Pérez')
  })
  it('"pérez" → "Pedro Pérez" (exact-token last-name, accent-insensitive)', () => {
    const out = fuzzyFind([c('1', 'Pedro Pérez')], 'pérez')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Pedro Pérez')
  })
  it('"monsalve" → "Ada Monsalve"', () => {
    const out = fuzzyFind([c('1', 'Ada Monsalve')], 'monsalve')
    expect(out.status).toBe('found')
  })
})

describe('fuzzyFind — exact and full matches', () => {
  it('full name match returns found', () => {
    const out = fuzzyFind([c('1', 'Pedro Pérez')], 'pedro pérez')
    expect(out.status).toBe('found')
  })
  it('accent-stripped query still matches accented candidate', () => {
    const out = fuzzyFind([c('1', 'María Pérez')], 'maria perez')
    expect(out.status).toBe('found')
  })
})

describe('fuzzyFind — typo tolerance via prefix arm', () => {
  it('"lizet" → "Lizeth Sánchez" (prefix arm, no exact token)', () => {
    const out = fuzzyFind([c('1', 'Lizeth Sánchez')], 'lizet')
    expect(out.status).toBe('found')
  })
})

describe('fuzzyFind — cross-name rejections (the C2.5 invariant we keep)', () => {
  it('"luis" vs "Estefany Zulura" alone → not_found', () => {
    const out = fuzzyFind([c('1', 'Estefany Zulura')], 'luis')
    expect(out.status).toBe('not_found')
  })
  it('"luis romero" vs only "Estefany Zulura" → not_found', () => {
    const out = fuzzyFind([c('1', 'Estefany Zulura')], 'luis romero')
    expect(out.status).toBe('not_found')
  })
  it('"lizeth" vs "Licey" → not_found (no shared token, no real prefix)', () => {
    const out = fuzzyFind([c('1', 'Licey')], 'lizeth')
    expect(out.status).toBe('not_found')
  })
  it('"gardi" vs only "Estefany Zulura" → not_found', () => {
    const out = fuzzyFind([c('1', 'Estefany Zulura')], 'gardi')
    expect(out.status).toBe('not_found')
  })
})

describe('fuzzyFind — ambiguity and tie-breaking', () => {
  it('"luis" with two Luis clients → ambiguous (no clear winner)', () => {
    const out = fuzzyFind(
      [c('1', 'Luis Romero'), c('2', 'Luis García')],
      'luis',
    )
    expect(out.status).toBe('ambiguous')
    expect(out.candidates?.length).toBe(2)
  })
  it('"luis romero" picks Luis Romero over Luis García', () => {
    const out = fuzzyFind(
      [c('1', 'Luis García'), c('2', 'Luis Romero')],
      'luis romero',
    )
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Luis Romero')
  })
  it('exact-token match wins over similarity-only competitor', () => {
    // "Gardi" exact-token in Gardi Suárez; meanwhile a similarly-spelled
    // "Garcin Dario" might score higher via similarity alone. The exact
    // token must win.
    const out = fuzzyFind(
      [c('1', 'Garcin Dario'), c('2', 'Gardi Suárez')],
      'gardi',
    )
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Gardi Suárez')
  })
})

describe('fuzzyFind — degenerate inputs', () => {
  it('empty candidate list → not_found', () => {
    expect(fuzzyFind([], 'anything').status).toBe('not_found')
  })
  it('empty query (no tokens) → not_found', () => {
    expect(fuzzyFind([c('1', 'Pedro')], '').status).toBe('not_found')
  })
  it('one-letter query → not_found (token < 2 chars filtered)', () => {
    expect(fuzzyFind([c('1', 'Pedro')], 'p').status).toBe('not_found')
  })
})
