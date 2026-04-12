/**
 * fuzzy-match.test.ts — Unit tests for AI fuzzy name matching.
 *
 * Covers: normalization, Levenshtein, similarity scoring,
 * exact match, substring match, ambiguous detection, not_found.
 */

import { describe, it, expect } from 'vitest'
import { fuzzyFind, FuzzyResult } from '@/lib/ai/fuzzy-match'

type Entity = { id: string; name: string }

const clients: Entity[] = [
  { id: '1', name: 'María López' },
  { id: '2', name: 'Carlos García' },
  { id: '3', name: 'Ana Martínez' },
  { id: '4', name: 'Pedro Sánchez' },
  { id: '5', name: 'José Hernández' },
  { id: '6', name: 'Alaisa Torres' }, // tricky spelling
]

// ── Exact / Substring Matches ────────────────────────────────────────────────

describe('fuzzyFind — exact and substring', () => {
  it('finds exact match', () => {
    const result = fuzzyFind(clients, 'María López')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('1')
  })

  it('finds case-insensitive match', () => {
    const result = fuzzyFind(clients, 'maria lopez')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('1')
  })

  it('finds accent-insensitive match', () => {
    const result = fuzzyFind(clients, 'Maria Lopez')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('1')
  })

  it('finds partial name match (first name)', () => {
    const result = fuzzyFind(clients, 'Carlos')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('2')
  })

  it('finds partial name match (last name)', () => {
    const result = fuzzyFind(clients, 'García')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('2')
  })

  it('handles extra whitespace', () => {
    const result = fuzzyFind(clients, '   Ana   Martínez   ')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('3')
  })
})

// ── Fuzzy / Levenshtein Matches ─────────────────────────────────────────────

describe('fuzzyFind — fuzzy matching', () => {
  it('finds misspelled name (1 char off)', () => {
    const result = fuzzyFind(clients, 'Maria Lope')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('1')
  })

  it('finds tricky spelling (Alaisa)', () => {
    const result = fuzzyFind(clients, 'Alaysa Torres')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('6')
  })

  it('finds name with accent variation', () => {
    const result = fuzzyFind(clients, 'Pedro Sanchez')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('4')
  })

  it('finds name with ñ variation', () => {
    const result = fuzzyFind(clients, 'Jose Hernandez')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('5')
  })
})

// ── Ambiguous Detection ──────────────────────────────────────────────────────

describe('fuzzyFind — ambiguous detection', () => {
  it('returns ambiguous for very short input matching multiple entities', () => {
    // "Ana" could match Ana Martínez, but also could be confused with others
    // depending on threshold. This tests the gap logic.
    const shortList: Entity[] = [
      { id: '1', name: 'Ana García' },
      { id: '2', name: 'Ana Martínez' },
    ]

    const result = fuzzyFind(shortList, 'Ana')
    // Both will have score 0.98 (substring match), gap = 0 → ambiguous
    expect(result.status).toBe('ambiguous')
    expect((result as any).candidates.length).toBe(2)
  })

  it('returns ambiguous when two entities have similar scores', () => {
    const similarList: Entity[] = [
      { id: '1', name: 'Carlos López' },
      { id: '2', name: 'Carlos Lopez' },
    ]

    const result = fuzzyFind(similarList, 'carlos')
    // Both are substring matches with score 0.98, gap = 0 → ambiguous
    expect(result.status).toBe('ambiguous')
  })

  it('returns top 3 candidates when ambiguous', () => {
    const manySimilar: Entity[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Carlos ${i}`,
    }))

    const result = fuzzyFind(manySimilar, 'carlos')
    expect(result.status).toBe('ambiguous')
    expect((result as any).candidates.length).toBeLessThanOrEqual(3)
  })
})

// ── Not Found ────────────────────────────────────────────────────────────────

describe('fuzzyFind — not found', () => {
  it('returns not_found for completely unrelated name', () => {
    const result = fuzzyFind(clients, 'XYZ123')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found for empty string', () => {
    const result = fuzzyFind(clients, '')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found for whitespace-only input', () => {
    const result = fuzzyFind(clients, '   ')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found for empty entity list', () => {
    const result = fuzzyFind([], 'María')
    expect(result.status).toBe('not_found')
  })

  it('returns not_found for very short unrelated input', () => {
    const result = fuzzyFind(clients, 'qw')
    expect(result.status).toBe('not_found')
  })
})

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe('fuzzyFind — edge cases', () => {
  it('handles single entity that matches', () => {
    const single: Entity[] = [{ id: '1', name: 'Test User' }]
    const result = fuzzyFind(single, 'test')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('1')
  })

  it('handles single entity that does not match', () => {
    const single: Entity[] = [{ id: '1', name: 'Test User' }]
    const result = fuzzyFind(single, 'zzzz')
    expect(result.status).toBe('not_found')
  })

  it('handles special characters in names', () => {
    const special: Entity[] = [{ id: '1', name: 'José María O\'Neill' }]
    const result = fuzzyFind(special, 'jose maria')
    expect(result.status).toBe('found')
  })

  it('handles numbers in names', () => {
    const numbered: Entity[] = [{ id: '1', name: 'Carlos 3ro' }]
    const result = fuzzyFind(numbered, 'carlos 3')
    expect(result.status).toBe('found')
  })

  it('returns found when there is only one match above threshold', () => {
    const mixed: Entity[] = [
      { id: '1', name: 'María López' },
      { id: '2', name: 'ZZZZ ZZZZ' }, // very different
    ]

    const result = fuzzyFind(mixed, 'maria')
    expect(result.status).toBe('found')
    expect((result as any).match.id).toBe('1')
  })
})
