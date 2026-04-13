/**
 * hexToHsl — Unit Tests
 *
 * Tests for lib/utils/color.ts
 * Pure mathematical function — critical for branding (if it returns wrong values,
 * the entire tenant branding breaks silently).
 */
import { describe, it, expect } from 'vitest'

import { hexToHsl } from '@/lib/utils/color'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('hexToHsl', () => {
  describe('edge cases — invalid input', () => {
    it('returns Cronix default for null', () => {
      expect(hexToHsl(null)).toBe('220 100% 50%')
    })

    it('returns Cronix default for undefined', () => {
      expect(hexToHsl(undefined)).toBe('220 100% 50%')
    })

    it('returns Cronix default for empty string', () => {
      expect(hexToHsl('')).toBe('220 100% 50%')
    })

    it('returns Cronix default for invalid hex (#ZZZ)', () => {
      expect(hexToHsl('#ZZZ')).toBe('220 100% 50%')
    })

    it('returns Cronix default for named color (blue)', () => {
      expect(hexToHsl('blue')).toBe('220 100% 50%')
    })

    it('returns Cronix default for short hex (#ABC)', () => {
      expect(hexToHsl('#ABC')).toBe('220 100% 50%')
    })
  })

  describe('valid hex colors', () => {
    it('converts Cronix primary (#0062FF) correctly', () => {
      expect(hexToHsl('#0062FF')).toBe('217 100% 50%')
    })

    it('converts purple (#A855F7) correctly', () => {
      expect(hexToHsl('#A855F7')).toBe('271 91% 65%')
    })

    it('converts black (#000000) correctly', () => {
      expect(hexToHsl('#000000')).toBe('0 0% 0%')
    })

    it('converts white (#FFFFFF) correctly', () => {
      expect(hexToHsl('#FFFFFF')).toBe('0 0% 100%')
    })

    it('converts red (#FF0000) correctly', () => {
      expect(hexToHsl('#FF0000')).toBe('0 100% 50%')
    })

    it('converts green (#00FF00) correctly', () => {
      expect(hexToHsl('#00FF00')).toBe('120 100% 50%')
    })

    it('converts blue (#0000FF) correctly', () => {
      expect(hexToHsl('#0000FF')).toBe('240 100% 50%')
    })

    it('handles lowercase hex', () => {
      expect(hexToHsl('#a855f7')).toBe('271 91% 65%')
    })

    it('handles hex with surrounding whitespace', () => {
      expect(hexToHsl('  #0062FF  ')).toBe('217 100% 50%')
    })
  })
})
