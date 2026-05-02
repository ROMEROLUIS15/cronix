/**
 * timezone.test.ts — Unit tests for lib/ai/core/utils/timezone.ts
 *
 * Coverage:
 *   localToUTC       — offsets correctos por timezone, DST, casos límite
 *   normalizeTime    — todos los formatos de entrada del LLM
 *   addMinutesToISO  — aritmética correcta
 *   toLocalDateString — extracción de fecha local
 */

import { describe, it, expect } from 'vitest'
import {
  localToUTC,
  normalizeTime,
  addMinutesToISO,
  toLocalDateString,
} from '@/lib/ai/core/utils/timezone'

// ── localToUTC ────────────────────────────────────────────────────────────────

describe('localToUTC', () => {
  it('convierte correctamente para Bogotá (UTC-5)', () => {
    const result = localToUTC('2026-05-03', '10:00', 'America/Bogota')
    expect(result).toBe('2026-05-03T15:00:00.000Z')
  })

  it('convierte correctamente para Caracas (UTC-4)', () => {
    const result = localToUTC('2026-05-03', '10:00', 'America/Caracas')
    expect(result).toBe('2026-05-03T14:00:00.000Z')
  })

  it('convierte correctamente para Ciudad de México (UTC-6)', () => {
    const result = localToUTC('2026-05-03', '10:00', 'America/Mexico_City')
    expect(result).toBe('2026-05-03T16:00:00.000Z')
  })

  it('retorna ISO string válido', () => {
    const result = localToUTC('2026-05-03', '15:30', 'America/Bogota')
    expect(() => new Date(result)).not.toThrow()
    expect(new Date(result).toISOString()).toBe(result)
  })

  it('maneja medianoche correctamente', () => {
    const result = localToUTC('2026-05-03', '00:00', 'America/Bogota')
    expect(result).toBe('2026-05-03T05:00:00.000Z')
  })

  it('maneja 23:59 correctamente', () => {
    const result = localToUTC('2026-05-03', '23:59', 'America/Bogota')
    expect(result).toBe('2026-05-04T04:59:00.000Z')
  })

  it('NO lanza con inputs válidos — el try/catch del dispatch los cubre', () => {
    expect(() => localToUTC('2026-05-03', '10:00', 'America/Bogota')).not.toThrow()
  })
})

// ── normalizeTime ─────────────────────────────────────────────────────────────

describe('normalizeTime — formatos válidos', () => {
  it('pasa HH:mm directamente', () => {
    expect(normalizeTime('15:00')).toBe('15:00')
    expect(normalizeTime('09:30')).toBe('09:30')
    expect(normalizeTime('00:00')).toBe('00:00')
    expect(normalizeTime('23:59')).toBe('23:59')
  })

  it('normaliza "5 PM" → "17:00"', () => {
    expect(normalizeTime('5 PM')).toBe('17:00')
  })

  it('normaliza "3 PM" → "15:00"', () => {
    expect(normalizeTime('3 PM')).toBe('15:00')
  })

  it('normaliza "3:00 PM" → "15:00"', () => {
    expect(normalizeTime('3:00 PM')).toBe('15:00')
  })

  it('normaliza "9am" → "09:00"', () => {
    expect(normalizeTime('9am')).toBe('09:00')
  })

  it('normaliza "9AM" → "09:00"', () => {
    expect(normalizeTime('9AM')).toBe('09:00')
  })

  it('normaliza "12 PM" (mediodía) → "12:00"', () => {
    expect(normalizeTime('12 PM')).toBe('12:00')
  })

  it('normaliza "12 AM" (medianoche) → "00:00"', () => {
    expect(normalizeTime('12 AM')).toBe('00:00')
  })

  it('normaliza "10:30 AM" → "10:30"', () => {
    expect(normalizeTime('10:30 AM')).toBe('10:30')
  })

  it('normaliza "1 pm" (minúsculas) → "13:00"', () => {
    expect(normalizeTime('1 pm')).toBe('13:00')
  })

  it('maneja espacios al inicio/final', () => {
    expect(normalizeTime('  15:00  ')).toBe('15:00')
  })
})

describe('normalizeTime — formatos inválidos (deben retornar null)', () => {
  it('retorna null para string vacío', () => {
    expect(normalizeTime('')).toBeNull()
  })

  it('retorna null para texto sin hora', () => {
    expect(normalizeTime('mañana')).toBeNull()
  })

  it('retorna null para hora con minutos > 59', () => {
    // "15:99" — el regex HHmm ya la rechaza, pero normalizeTime también
    expect(normalizeTime('15:99')).toBeNull()
  })

  it('retorna null para hora 24 o mayor', () => {
    // La hora > 23 retorna null (h > 23 check)
    expect(normalizeTime('25:00')).toBeNull()
    expect(normalizeTime('24:00')).toBeNull()
  })

  it('retorna null para formato completamente inválido', () => {
    expect(normalizeTime('abc')).toBeNull()
    expect(normalizeTime('--:--')).toBeNull()
  })
})

// ── addMinutesToISO ───────────────────────────────────────────────────────────

describe('addMinutesToISO', () => {
  it('suma 45 minutos correctamente', () => {
    const start = '2026-05-03T15:00:00.000Z'
    const end   = addMinutesToISO(start, 45)
    expect(end).toBe('2026-05-03T15:45:00.000Z')
  })

  it('suma 60 minutos (1 hora)', () => {
    const result = addMinutesToISO('2026-05-03T23:00:00.000Z', 60)
    expect(result).toBe('2026-05-04T00:00:00.000Z')
  })

  it('suma 30 minutos', () => {
    const result = addMinutesToISO('2026-05-03T10:00:00.000Z', 30)
    expect(result).toBe('2026-05-03T10:30:00.000Z')
  })

  it('suma 0 minutos → mismo ISO', () => {
    const iso = '2026-05-03T10:00:00.000Z'
    expect(addMinutesToISO(iso, 0)).toBe(iso)
  })

  it('retorna ISO string válido', () => {
    const result = addMinutesToISO('2026-05-03T15:00:00.000Z', 90)
    expect(() => new Date(result)).not.toThrow()
  })
})

// ── toLocalDateString ─────────────────────────────────────────────────────────

describe('toLocalDateString', () => {
  it('extrae fecha local en Bogotá (UTC-5)', () => {
    // 2026-05-04T02:00:00Z → en Bogotá (UTC-5) es aún 2026-05-03T21:00
    const result = toLocalDateString('2026-05-04T02:00:00.000Z', 'America/Bogota')
    expect(result).toBe('2026-05-03')
  })

  it('extrae fecha local en Caracas (UTC-4)', () => {
    // 2026-05-03T15:00:00Z → en Caracas (UTC-4) es 2026-05-03T11:00
    const result = toLocalDateString('2026-05-03T15:00:00.000Z', 'America/Caracas')
    expect(result).toBe('2026-05-03')
  })

  it('retorna formato YYYY-MM-DD', () => {
    const result = toLocalDateString('2026-05-03T15:00:00.000Z', 'America/Bogota')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
