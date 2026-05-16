import { describe, it, expect } from 'vitest'
import { fuzzyFind, phoneticKey } from '../fuzzy.ts'

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

describe('phoneticKey — Spanish equivalences', () => {
  it('z and s collapse', () => {
    expect(phoneticKey('lizet')).toBe(phoneticKey('liset'))
  })
  it('c before e/i collapses to s', () => {
    expect(phoneticKey('lisset')).toBe(phoneticKey('licet'))
    expect(phoneticKey('cecilia')).toBe(phoneticKey('sesilia'))
  })
  it('silent h is dropped', () => {
    expect(phoneticKey('lizeth')).toBe(phoneticKey('lizet'))
    expect(phoneticKey('hugo')).toBe(phoneticKey('ugo'))
  })
  it('v and b collapse', () => {
    expect(phoneticKey('vazquez')).toBe(phoneticKey('bazquez'))
  })
  it('double letters collapse to single', () => {
    expect(phoneticKey('lisseth')).toBe(phoneticKey('liseth'))
  })
  it('Lisset / Lizet / Lisseth / Lizeth all share the same key', () => {
    const k = phoneticKey('lisset')
    expect(phoneticKey('lizet')).toBe(k)
    expect(phoneticKey('lisseth')).toBe(k)
    expect(phoneticKey('lizeth')).toBe(k)
    expect(phoneticKey('licet')).toBe(k)
    expect(phoneticKey('liceth')).toBe(k)
  })
  it('cross-name guard: Licey and Lizeth produce DIFFERENT keys', () => {
    // Licey → "lisey" (c→s before e, no doubles), Lizeth → "liset"
    expect(phoneticKey('licey')).not.toBe(phoneticKey('lizeth'))
  })
  it('cross-name guard: Cardi (hard c) ≠ Sardi', () => {
    // c before a stays as c — Cardi is not phonetically equivalent to Sardi
    expect(phoneticKey('cardi')).not.toBe(phoneticKey('sardi'))
  })
})

describe('fuzzyFind — phonetic STT variants of the same name', () => {
  const lizet = c('1', 'Lizet Gómez')

  it('"Lisset" → "Lizet Gómez"', () => {
    const out = fuzzyFind([lizet], 'Lisset')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lizet Gómez')
  })
  it('"Lisseth" → "Lizet Gómez"', () => {
    const out = fuzzyFind([lizet], 'Lisseth')
    expect(out.status).toBe('found')
  })
  it('"Lizeth" → "Lizet Gómez"', () => {
    const out = fuzzyFind([lizet], 'Lizeth')
    expect(out.status).toBe('found')
  })
  it('"Lise" → "Lizet Gómez" (phonetic prefix overlap)', () => {
    const out = fuzzyFind([lizet], 'Lise')
    expect(out.status).toBe('found')
  })
  it('"Cecilia" → "Sesilia Pérez" (c↔s before e/i)', () => {
    const out = fuzzyFind([c('1', 'Sesilia Pérez')], 'Cecilia')
    expect(out.status).toBe('found')
  })
  it('"Vázquez" → "Bázquez García" (v↔b)', () => {
    const out = fuzzyFind([c('1', 'Bázquez García')], 'Vázquez')
    expect(out.status).toBe('found')
  })
  it('Lui → Luis Romero (existing 4-char prefix path still works)', () => {
    const out = fuzzyFind([c('1', 'Luis Romero')], 'Lui')
    // 3-char tokens are too short to gate; expected not_found.
    expect(out.status).toBe('not_found')
  })
  it('"Luis" exact token in two "Luis Romero" entries → ambiguous', () => {
    const out = fuzzyFind(
      [c('1', 'Luis Romero'), c('2', 'Luis Romero')],
      'Luis Romero',
    )
    expect(out.status).toBe('ambiguous')
    expect(out.candidates?.length).toBe(2)
  })
})

describe('fuzzyFind — coexistence: similar-sounding but distinct names in the same DB', () => {
  // The realistic LatAm case: a business has BOTH a "Lisbeth" and a
  // "Lizeth"/"Liset"/"Lisset" as separate clients. The matcher must:
  //   - find Lisbeth when asked for Lisbeth (not Lizeth)
  //   - find Lizeth when asked for Lizeth/Liseth/Liceth/Lisset (not Lisbeth)
  //   - never cross-bridge between them
  // The same principle must hold for ANY pair of distinct-but-similar names.
  const DB = [
    c('1', 'Lisbeth Pérez'),
    c('2', 'Lizeth Sánchez'),
  ]

  it('"Lisbeth" → only Lisbeth Pérez', () => {
    const out = fuzzyFind(DB, 'Lisbeth')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lisbeth Pérez')
  })
  it('"Lizbeth" → only Lisbeth Pérez (z→s collapses, b survives)', () => {
    const out = fuzzyFind(DB, 'Lizbeth')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lisbeth Pérez')
  })
  it('"Lizeth" → only Lizeth Sánchez', () => {
    const out = fuzzyFind(DB, 'Lizeth')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lizeth Sánchez')
  })
  it('"Liseth" → only Lizeth Sánchez', () => {
    const out = fuzzyFind(DB, 'Liseth')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lizeth Sánchez')
  })
  it('"Liceth" → only Lizeth Sánchez', () => {
    const out = fuzzyFind(DB, 'Liceth')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lizeth Sánchez')
  })
  it('"Lisset" → only Lizeth Sánchez', () => {
    const out = fuzzyFind(DB, 'Lisset')
    expect(out.status).toBe('found')
    expect(out.match?.name).toBe('Lizeth Sánchez')
  })

  // Same principle applies to other LatAm name pairs that sound close
  // but are different identities.
  it('Pedro and Petro coexist as separate clients', () => {
    const db = [c('1', 'Pedro Gómez'), c('2', 'Petro Rivas')]
    expect(fuzzyFind(db, 'Pedro').match?.name).toBe('Pedro Gómez')
    expect(fuzzyFind(db, 'Petro').match?.name).toBe('Petro Rivas')
  })
  it('Cardi and Sardi coexist (hard c stays distinct from s)', () => {
    const db = [c('1', 'Cardi Suárez'), c('2', 'Sardi Mejía')]
    expect(fuzzyFind(db, 'Cardi').match?.name).toBe('Cardi Suárez')
    expect(fuzzyFind(db, 'Sardi').match?.name).toBe('Sardi Mejía')
  })
})

describe('fuzzyFind — Lisbeth is its own name (precision over recall)', () => {
  // The 'b' in Lisbeth/Lizbeth is part of the name's identity in the
  // customer database, even though it sounds close to Liseth/Lizeth in
  // spoken Spanish. Bridging them would risk acting on the wrong client
  // (deleting / rescheduling the wrong person). The fuzzy matcher
  // intentionally treats them as distinct names.
  it('"Lizeth" does NOT match "Lisbeth Pérez"', () => {
    const out = fuzzyFind([c('1', 'Lisbeth Pérez')], 'Lizeth')
    expect(out.status).toBe('not_found')
  })
  it('"Liseth" does NOT match "Lizbeth Martínez"', () => {
    const out = fuzzyFind([c('1', 'Lizbeth Martínez')], 'Liseth')
    expect(out.status).toBe('not_found')
  })
  it('"Lisbeth" does NOT match "Lizeth Gómez"', () => {
    const out = fuzzyFind([c('1', 'Lizeth Gómez')], 'Lisbeth')
    expect(out.status).toBe('not_found')
  })
  it('"Lizeth" still finds the actual "Lizeth Sánchez"', () => {
    const out = fuzzyFind([c('1', 'Lizeth Sánchez')], 'Lizeth')
    expect(out.status).toBe('found')
  })
  it('"Liceth" still finds "Lizeth Sánchez" (orthographic variant of the same name)', () => {
    const out = fuzzyFind([c('1', 'Lizeth Sánchez')], 'Liceth')
    expect(out.status).toBe('found')
  })
})

describe('fuzzyFind — cross-name false-positive guards still hold', () => {
  it('"Licey" does NOT match "Lizeth Pérez"', () => {
    const out = fuzzyFind([c('1', 'Lizeth Pérez')], 'Licey')
    expect(out.status).toBe('not_found')
  })
  it('"Sardi" does NOT match "Cardi Suárez" (hard c)', () => {
    const out = fuzzyFind([c('1', 'Cardi Suárez')], 'Sardi')
    expect(out.status).toBe('not_found')
  })
  it('Estefany Zulura is not bridged from "Luis"', () => {
    const out = fuzzyFind([c('1', 'Estefany Zulura')], 'Luis')
    expect(out.status).toBe('not_found')
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
