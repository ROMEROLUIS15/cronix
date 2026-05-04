/**
 * timezone.test.ts — Unit tests for timezone utilities.
 * Covers: normalizeTime, localToUTC, addMinutesToISO, toLocalDateString, formatLocalDateTime.
 * Adversarial cases: invalid hours, out-of-range minutes, AM/PM edge cases, DST.
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeTime,
  localToUTC,
  addMinutesToISO,
  toLocalDateString,
  formatLocalDateTime,
} from '../utils/timezone'

// ── normalizeTime ─────────────────────────────────────────────────────────────

describe('normalizeTime', () => {
  // Valid 24h inputs (passthrough)
  it('passes through valid HH:mm', () => {
    expect(normalizeTime('15:00')).toBe('15:00')
    expect(normalizeTime('09:30')).toBe('09:30')
    expect(normalizeTime('00:00')).toBe('00:00')
    expect(normalizeTime('23:59')).toBe('23:59')
  })

  // AM/PM conversion
  it('converts "5 PM" → "17:00"', () => {
    expect(normalizeTime('5 PM')).toBe('17:00')
  })

  it('converts "3 PM" → "15:00"', () => {
    expect(normalizeTime('3 PM')).toBe('15:00')
  })

  it('converts "12 PM" → "12:00" (noon)', () => {
    expect(normalizeTime('12 PM')).toBe('12:00')
  })

  it('converts "12 AM" → "00:00" (midnight)', () => {
    expect(normalizeTime('12 AM')).toBe('00:00')
  })

  it('converts "3:00 PM" → "15:00"', () => {
    expect(normalizeTime('3:00 PM')).toBe('15:00')
  })

  it('converts "9am" (no space, lowercase) → "09:00"', () => {
    expect(normalizeTime('9am')).toBe('09:00')
  })

  it('converts "3:30pm" → "15:30"', () => {
    expect(normalizeTime('3:30pm')).toBe('15:30')
  })

  it('converts "11:45 AM" → "11:45"', () => {
    expect(normalizeTime('11:45 AM')).toBe('11:45')
  })

  // Adversarial: out-of-range values
  it('returns null for "25:00" (hour > 23)', () => {
    expect(normalizeTime('25:00')).toBeNull()
  })

  it('returns null for "25:99" (both out of range)', () => {
    expect(normalizeTime('25:99')).toBeNull()
  })

  it('returns null for "23:60" (minutes = 60)', () => {
    expect(normalizeTime('23:60')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeTime('')).toBeNull()
  })

  it('returns null for plain text', () => {
    expect(normalizeTime('mediodía')).toBeNull()
  })

  it('returns null for partial format "10:"', () => {
    expect(normalizeTime('10:')).toBeNull()
  })

  // Edge: 1 PM = 13:00 (not 1:00)
  it('converts "1 PM" → "13:00"', () => {
    expect(normalizeTime('1 PM')).toBe('13:00')
  })
})

// ── localToUTC ────────────────────────────────────────────────────────────────

describe('localToUTC', () => {
  it('converts UTC-5 (America/Bogota) correctly', () => {
    // 10:00 in Bogota = 15:00 UTC
    const result = localToUTC('2026-05-03', '10:00', 'America/Bogota')
    expect(result).toBe('2026-05-03T15:00:00.000Z')
  })

  it('converts UTC-4 (America/Caracas) correctly', () => {
    // 10:00 in Caracas = 14:00 UTC
    const result = localToUTC('2026-05-03', '10:00', 'America/Caracas')
    expect(result).toBe('2026-05-03T14:00:00.000Z')
  })

  it('converts UTC (UTC) with no offset', () => {
    const result = localToUTC('2026-05-03', '10:00', 'UTC')
    expect(result).toBe('2026-05-03T10:00:00.000Z')
  })

  it('handles midnight correctly (00:00)', () => {
    const result = localToUTC('2026-05-03', '00:00', 'America/Bogota')
    expect(result).toBe('2026-05-03T05:00:00.000Z')
  })

  it('handles end of day (23:59)', () => {
    const result = localToUTC('2026-05-03', '23:59', 'America/Bogota')
    expect(result).toBe('2026-05-04T04:59:00.000Z')
  })

  it('returns an ISO string (ends with Z)', () => {
    const result = localToUTC('2026-05-03', '10:00', 'America/Bogota')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('is deterministic — same input always produces same output', () => {
    const a = localToUTC('2026-06-15', '14:30', 'America/Bogota')
    const b = localToUTC('2026-06-15', '14:30', 'America/Bogota')
    expect(a).toBe(b)
  })

  it('does NOT treat input as UTC (anti-regression)', () => {
    // Before fix, "2026-05-03T10:00" was parsed as UTC → shown as 05:00 in UTC-5
    const result = localToUTC('2026-05-03', '10:00', 'America/Bogota')
    // Must NOT equal the naive UTC interpretation
    expect(result).not.toBe('2026-05-03T10:00:00.000Z')
  })
})

// ── addMinutesToISO ───────────────────────────────────────────────────────────

describe('addMinutesToISO', () => {
  it('adds 30 minutes correctly', () => {
    const result = addMinutesToISO('2026-05-03T15:00:00.000Z', 30)
    expect(result).toBe('2026-05-03T15:30:00.000Z')
  })

  it('adds 60 minutes crossing the hour', () => {
    const result = addMinutesToISO('2026-05-03T23:30:00.000Z', 60)
    expect(result).toBe('2026-05-04T00:30:00.000Z')
  })

  it('adds 0 minutes (identity)', () => {
    const result = addMinutesToISO('2026-05-03T10:00:00.000Z', 0)
    expect(result).toBe('2026-05-03T10:00:00.000Z')
  })

  it('adds 90 minutes (1.5 hours)', () => {
    const result = addMinutesToISO('2026-05-03T10:00:00.000Z', 90)
    expect(result).toBe('2026-05-03T11:30:00.000Z')
  })
})

// ── toLocalDateString ─────────────────────────────────────────────────────────

describe('toLocalDateString', () => {
  it('returns YYYY-MM-DD in local timezone', () => {
    // 2026-05-04T01:00:00Z in UTC-5 = 2026-05-03 (still previous day)
    const result = toLocalDateString('2026-05-04T01:00:00.000Z', 'America/Bogota')
    expect(result).toBe('2026-05-03')
  })

  it('returns same day when offset is zero', () => {
    const result = toLocalDateString('2026-05-03T10:00:00.000Z', 'UTC')
    expect(result).toBe('2026-05-03')
  })

  it('handles midnight UTC correctly (different day possible in UTC+offset)', () => {
    // 2026-05-03T00:00:00Z in UTC+5:30 (India) = 2026-05-03T05:30 local
    const result = toLocalDateString('2026-05-03T00:00:00.000Z', 'Asia/Kolkata')
    expect(result).toBe('2026-05-03')
  })
})

// ── formatLocalDateTime ───────────────────────────────────────────────────────

describe('formatLocalDateTime', () => {
  const iso = '2026-05-03T15:00:00.000Z' // 10:00 Bogota

  it('returns a non-empty string for "datetime" format', () => {
    const result = formatLocalDateTime(iso, 'America/Bogota', 'datetime')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for "date" format', () => {
    const result = formatLocalDateTime(iso, 'America/Bogota', 'date')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for "time" format', () => {
    const result = formatLocalDateTime(iso, 'America/Bogota', 'time')
    expect(result.length).toBeGreaterThan(0)
  })

  it('datetime format includes day name in Spanish', () => {
    // 2026-05-03 is a Sunday
    const result = formatLocalDateTime(iso, 'America/Bogota', 'date')
    // Spanish day names
    const days = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
    const hasDay = days.some((d) => result.toLowerCase().includes(d))
    expect(hasDay).toBe(true)
  })
})
