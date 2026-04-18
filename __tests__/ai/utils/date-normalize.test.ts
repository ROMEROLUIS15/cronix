/**
 * date-normalize.test.ts
 *
 * Unit tests for lib/ai/utils/date-normalize.ts
 *
 * These are pure-function tests — no mocks, no network, no DB.
 * Covers: normalizeDateInput, normalizeTimeInput, extractEntities.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { normalizeDateInput, normalizeTimeInput, extractEntities } from '@/lib/ai/utils/date-normalize'

const TZ = 'America/Bogota'

// ── Freeze time so relative tests are deterministic ──────────────────────────
// Pin to a known Wednesday: 2026-04-22 (so "mañana" = 2026-04-23, etc.)
const FIXED_NOW = new Date('2026-04-22T12:00:00-05:00').getTime()

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterAll(() => {
  vi.useRealTimers()
})

// ── normalizeDateInput ────────────────────────────────────────────────────────

describe('normalizeDateInput', () => {

  describe('relative terms', () => {
    it('resolves "hoy"', () => {
      expect(normalizeDateInput('hoy', TZ)).toBe('2026-04-22')
    })

    it('resolves "mañana"', () => {
      expect(normalizeDateInput('mañana', TZ)).toBe('2026-04-23')
    })

    it('resolves "pasado mañana"', () => {
      expect(normalizeDateInput('pasado mañana', TZ)).toBe('2026-04-24')
    })

    it('resolves "hoy" case-insensitively', () => {
      expect(normalizeDateInput('HOY', TZ)).toBe('2026-04-22')
    })
  })

  describe('weekday resolution (next occurrence from Wednesday 2026-04-22)', () => {
    // Current day is Wednesday → "el miércoles" should be next week
    it('resolves "el lunes" to next Monday', () => {
      expect(normalizeDateInput('el lunes', TZ)).toBe('2026-04-27')
    })

    it('resolves "el jueves" to next Thursday (this week)', () => {
      expect(normalizeDateInput('el jueves', TZ)).toBe('2026-04-23')
    })

    it('resolves "el viernes" to next Friday', () => {
      expect(normalizeDateInput('el viernes', TZ)).toBe('2026-04-24')
    })

    it('resolves "el lunes" as lowercase variant', () => {
      expect(normalizeDateInput('lunes', TZ)).toBe('2026-04-27')
    })
  })

  describe('explicit day formats', () => {
    it('resolves "el 27" to 2026-04-27 (within current month)', () => {
      expect(normalizeDateInput('el 27', TZ)).toBe('2026-04-27')
    })

    it('resolves "27 de mayo" to 2026-05-27', () => {
      expect(normalizeDateInput('27 de mayo', TZ)).toBe('2026-05-27')
    })

    it('resolves ISO date passthrough "2026-06-15"', () => {
      expect(normalizeDateInput('2026-06-15', TZ)).toBe('2026-06-15')
    })

    it('resolves dd/mm/yyyy "15/06/2026"', () => {
      expect(normalizeDateInput('15/06/2026', TZ)).toBe('2026-06-15')
    })
  })

  describe('unresolvable inputs', () => {
    it('returns null for empty string', () => {
      expect(normalizeDateInput('', TZ)).toBeNull()
    })

    it('returns null for unrecognized text', () => {
      expect(normalizeDateInput('próxima semana que viene', TZ)).toBeNull()
    })
  })
})

// ── normalizeTimeInput ────────────────────────────────────────────────────────

describe('normalizeTimeInput', () => {

  describe('12-hour format', () => {
    it('resolves "3pm" → "15:00"', () => {
      expect(normalizeTimeInput('3pm')).toBe('15:00')
    })

    it('resolves "3:30pm" → "15:30"', () => {
      expect(normalizeTimeInput('3:30pm')).toBe('15:30')
    })

    it('resolves "3:30 pm" with space', () => {
      expect(normalizeTimeInput('3:30 pm')).toBe('15:30')
    })

    it('resolves "12pm" → "12:00"', () => {
      expect(normalizeTimeInput('12pm')).toBe('12:00')
    })

    it('resolves "12am" → "00:00"', () => {
      expect(normalizeTimeInput('12am')).toBe('00:00')
    })

    it('resolves "11am" → "11:00"', () => {
      expect(normalizeTimeInput('11am')).toBe('11:00')
    })
  })

  describe('24-hour format passthrough', () => {
    it('resolves "15:00" → "15:00"', () => {
      expect(normalizeTimeInput('15:00')).toBe('15:00')
    })

    it('resolves "09:30" → "09:30"', () => {
      expect(normalizeTimeInput('09:30')).toBe('09:30')
    })
  })

  describe('natural language time', () => {
    it('resolves "mediodía" → "12:00"', () => {
      expect(normalizeTimeInput('mediodía')).toBe('12:00')
    })

    it('resolves "3 de la tarde" → "15:00"', () => {
      expect(normalizeTimeInput('3 de la tarde')).toBe('15:00')
    })

    it('resolves "3 de la mañana" → "03:00"', () => {
      expect(normalizeTimeInput('3 de la mañana')).toBe('03:00')
    })
  })

  describe('unresolvable inputs', () => {
    it('returns null for empty string', () => {
      expect(normalizeTimeInput('')).toBeNull()
    })

    it('returns null for unrecognized text', () => {
      expect(normalizeTimeInput('en un rato')).toBeNull()
    })
  })
})

// ── extractEntities ───────────────────────────────────────────────────────────

describe('extractEntities', () => {
  it('extracts date and time when both present', () => {
    const result = extractEntities('quiero agendar mañana a las 3pm', TZ)
    expect(result.date).toBe('2026-04-23')
    expect(result.time).toBe('15:00')
  })

  it('extracts only date when no time mentioned', () => {
    const result = extractEntities('el lunes por favor', TZ)
    expect(result.date).toBe('2026-04-27')
    expect(result.time).toBeNull()
  })

  it('extracts only time when no date mentioned', () => {
    const result = extractEntities('a las 10am', TZ)
    expect(result.date).toBeNull()
    expect(result.time).toBe('10:00')
  })

  it('returns both null when nothing recognizable', () => {
    const result = extractEntities('hola, ¿cómo están?', TZ)
    expect(result.date).toBeNull()
    expect(result.time).toBeNull()
  })
})
