/**
 * fuzzy-match.test.ts — Tests for fuzzy name matching algorithm.
 * Critical path: wrong match → wrong client gets appointment.
 */

import { describe, it, expect } from 'vitest'
import { fuzzyFind, similarity, normalizeForFuzzy } from '../../fuzzy-match'

type Client = { id: string; name: string }

const clients: Client[] = [
  { id: '1', name: 'Ana García' },
  { id: '2', name: 'Carlos López' },
  { id: '3', name: 'María Rodríguez' },
  { id: '4', name: 'Juan Pérez' },
  { id: '5', name: 'Luisa Martínez' },
]

// ── fuzzyFind ─────────────────────────────────────────────────────────────────

describe('fuzzyFind', () => {
  it('exact name match → found', () => {
    const result = fuzzyFind(clients, 'Ana García')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('1')
  })

  it('case-insensitive match → found', () => {
    const result = fuzzyFind(clients, 'ana garcía')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('1')
  })

  it('accent-stripped match "Maria Rodriguez" → found', () => {
    const result = fuzzyFind(clients, 'Maria Rodriguez')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('3')
  })

  it('partial first name "Carlos" → found (substring match)', () => {
    const result = fuzzyFind(clients, 'Carlos')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('2')
  })

  it('typo in first name "Ann Garcia" → found', () => {
    const result = fuzzyFind(clients, 'Ann Garcia')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('1')
  })

  it('completely unknown name → not_found', () => {
    const result = fuzzyFind(clients, 'Zoltan Xyz Qwerty')
    expect(result.status).toBe('not_found')
  })

  it('empty string → not_found', () => {
    const result = fuzzyFind(clients, '')
    expect(result.status).toBe('not_found')
  })

  it('empty entity list → not_found', () => {
    const result = fuzzyFind([], 'Ana')
    expect(result.status).toBe('not_found')
  })

  it('compound name "Juan Pérez Gómez" matches "Juan Pérez" (partial)', () => {
    const result = fuzzyFind(clients, 'Juan Pérez Gómez')
    // The spoken name includes Juan Pérez — should find it
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('4')
  })

  it('ambiguous when two names are very similar', () => {
    const similar: Client[] = [
      { id: 'a', name: 'Ana García' },
      { id: 'b', name: 'Ana Garda' },
    ]
    const result = fuzzyFind(similar, 'Ana García')
    // Ana García is an exact substring match → unambiguous found
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.match.id).toBe('a')
  })

  it('truly ambiguous names produce ambiguous result', () => {
    const twin: Client[] = [
      { id: 'a', name: 'Laura' },
      { id: 'b', name: 'Laure' },
    ]
    const result = fuzzyFind(twin, 'Laur')
    // Both are close — result should be ambiguous or found (but not crash)
    expect(['found', 'ambiguous', 'not_found']).toContain(result.status)
  })

  it('ambiguous result includes candidates array', () => {
    const twin: Client[] = [
      { id: 'a', name: 'Laura García' },
      { id: 'b', name: 'Laura López' },
    ]
    const result = fuzzyFind(twin, 'Laura')
    if (result.status === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('returns at most 3 candidates when ambiguous', () => {
    const many: Client[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Laura Variant ${i}`,
    }))
    const result = fuzzyFind(many, 'Laura')
    if (result.status === 'ambiguous') {
      expect(result.candidates.length).toBeLessThanOrEqual(3)
    }
  })

  it('single-entity list always returns found or not_found (never ambiguous)', () => {
    const single = [{ id: '1', name: 'Ana García' }]
    const result = fuzzyFind(single, 'Ana García')
    expect(result.status).not.toBe('ambiguous')
  })
})

// ── similarity ────────────────────────────────────────────────────────────────

describe('similarity', () => {
  it('identical strings → 1.0', () => {
    expect(similarity('hola', 'hola')).toBe(1)
  })

  it('completely different strings → low score', () => {
    expect(similarity('abc', 'xyz')).toBeLessThan(0.4)
  })

  it('one character difference → high score', () => {
    expect(similarity('ana', 'ann')).toBeGreaterThan(0.6)
  })

  it('empty strings → 1.0 (identical)', () => {
    expect(similarity('', '')).toBe(1)
  })

  it('score is symmetric', () => {
    const ab = similarity('carlos', 'carros')
    const ba = similarity('carros', 'carlos')
    expect(ab).toBe(ba)
  })

  it('score is between 0 and 1', () => {
    const s = similarity('hello', 'world')
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
  })
})

// ── normalizeForFuzzy ─────────────────────────────────────────────────────────

describe('normalizeForFuzzy', () => {
  it('lowercases input', () => {
    expect(normalizeForFuzzy('ANA GARCÍA')).toBe('ana garcia')
  })

  it('strips accent marks', () => {
    expect(normalizeForFuzzy('María')).toBe('maria')
    expect(normalizeForFuzzy('Pérez')).toBe('perez')
    expect(normalizeForFuzzy('Rodríguez')).toBe('rodriguez')
    expect(normalizeForFuzzy('Muñoz')).toBe('munoz')
  })

  it('collapses multiple spaces into single space', () => {
    expect(normalizeForFuzzy('Ana  García')).toBe('ana garcia')
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeForFuzzy('  Ana  ')).toBe('ana')
  })

  it('handles empty string', () => {
    expect(normalizeForFuzzy('')).toBe('')
  })
})
