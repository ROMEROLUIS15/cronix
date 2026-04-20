/**
 * WhatsApp Agent — Prompt Builder Tests
 *
 * Tests for supabase/functions/process-whatsapp/prompt-builder.ts
 * Covers: system prompt building, success templates, time formatting.
 */
import { describe, it, expect } from 'vitest'

import {
  formatLocalTime,
  buildMinimalSystemPrompt,
  renderBookingSuccessTemplate,
} from '../../supabase/functions/process-whatsapp/prompt-builder'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides = {}): any {
  return {
    business: {
      name: 'Mi Salón',
      timezone: 'America/Bogota',
      settings: {
        working_hours: { monday: ['09:00', '18:00'], tuesday: ['09:00', '18:00'] },
      },
    },
    services: [
      { id: 'svc-1', name: 'Corte', duration_min: 30, price: 50 },
      { id: 'svc-2', name: 'Tinte', duration_min: 60, price: 80 },
    ],
    client: { id: 'c-1', name: 'María García', phone: '+573001234567' },
    activeAppointments: [],
    bookedSlots: [],
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WhatsApp Agent — formatLocalTime', () => {
  it('converts morning times correctly', () => {
    expect(formatLocalTime('09:00')).toBe('9:00 am')
    expect(formatLocalTime('10:30')).toBe('10:30 am')
  })

  it('converts afternoon times correctly', () => {
    expect(formatLocalTime('15:00')).toBe('3:00 pm')
    expect(formatLocalTime('22:30')).toBe('10:30 pm')
  })

  it('handles noon correctly', () => {
    expect(formatLocalTime('12:00')).toBe('12:00 pm')
  })

  it('handles midnight correctly', () => {
    expect(formatLocalTime('00:00')).toBe('12:00 am')
    expect(formatLocalTime('00:30')).toBe('12:30 am')
  })
})

describe('WhatsApp Agent — buildMinimalSystemPrompt', () => {
  it('includes business name', () => {
    const ctx = makeContext()
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    expect(prompt).toContain('Mi Salón')
  })

  it('includes services catalog with REF#', () => {
    const ctx = makeContext()
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    expect(prompt).toContain('Corte')
    expect(prompt).toContain('Tinte')
    expect(prompt).toContain('REF#svc-1')
  })

  it('includes client name from WhatsApp', () => {
    const ctx = makeContext()
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    expect(prompt).toContain('WhatsApp: María')
  })

  it('includes active appointments', () => {
    const ctx = makeContext({
      activeAppointments: [
        { id: 'apt-1', start_at: '2026-04-10T15:00:00Z', service_name: 'Corte', status: 'confirmed' },
      ],
    })
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    // Active appointments are included in the prompt (format may vary)
    expect(prompt).toContain('apt-1')
    expect(prompt).toContain('Corte')
  })

  it('includes working hours', () => {
    const ctx = makeContext()
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    expect(prompt).toContain('Horario de atención')
    expect(prompt).toContain('monday')
  })

  it('includes timezone', () => {
    const ctx = makeContext()
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    expect(prompt).toContain('America/Bogota')
  })

  it('handles new client (no registration)', () => {
    const ctx = makeContext({ client: null })
    const prompt = buildMinimalSystemPrompt(ctx, 'Unknown')

    expect(prompt).toContain('Cliente nuevo')
  })

  it('caps booked slots at 50', () => {
    const slots = Array.from({ length: 100 }, (_, i) => ({
      start_at: `2026-04-10T${String(9 + (i % 9)).padStart(2, '0')}:00:00`,
      end_at: `2026-04-10T${String(9 + (i % 9)).padStart(2, '0')}:30:00`,
    }))
    const ctx = makeContext({ bookedSlots: slots })
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    // Should contain capped slots section but not all 100
    expect(prompt).toContain('HORARIOS YA OCUPADOS')
    const occupiedCount = (prompt.match(/• OCUPADO:/g) || []).length
    expect(occupiedCount).toBeLessThanOrEqual(50)
  })

  it('includes ReAct flow rules', () => {
    const ctx = makeContext()
    const prompt = buildMinimalSystemPrompt(ctx, 'María')

    expect(prompt).toContain('CATÁLOGO DE SERVICIOS')
    expect(prompt).toContain('HORARIO Y REGLAS')
    expect(prompt).toContain('FECHAS')
  })
})

describe('WhatsApp Agent — renderBookingSuccessTemplate', () => {
  it('renders confirm_booking with date and time', () => {
    const result = renderBookingSuccessTemplate('confirm_booking', {
      service_name: 'Corte',
      date: '2026-04-10',
      time: '15:00',
    }, 'America/Bogota')

    expect(result).toContain('Corte')
    expect(result).toContain('viernes')
    expect(result).toContain('3:00 pm')
  })

  it('renders confirm_booking fallback without date', () => {
    const result = renderBookingSuccessTemplate('confirm_booking', {
      service_name: 'Corte',
    }, 'America/Bogota')

    expect(result).toContain('Corte')
    expect(result).toContain('agendada')
  })

  it('renders reschedule_booking with new date', () => {
    const result = renderBookingSuccessTemplate('reschedule_booking', {
      service_name: 'Tinte',
      new_date: '2026-04-15',
      new_time: '10:30',
    }, 'America/Bogota')

    expect(result).toContain('Tinte')
    expect(result).toContain('reagendada')
    expect(result).toContain('10:30 am')
  })

  it('renders cancel_booking', () => {
    const result = renderBookingSuccessTemplate('cancel_booking', {
      service_name: 'Corte',
    }, 'America/Bogota')

    expect(result).toContain('cancelada')
    expect(result).toContain('Corte')
  })

  it('returns generic message for unknown tool', () => {
    const result = renderBookingSuccessTemplate('unknown_tool', {}, 'America/Bogota')

    expect(result).toBe('✅ Acción completada.')
  })
})
