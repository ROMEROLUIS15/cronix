/**
 * booking-flow.test.ts — Deterministic booking state machine.
 *
 * Locks the zero-hallucination contract: the LLM never emits service_id/date/time
 * and never proposes a time. resolveBookingTurn either executes with validated,
 * code-derived args, replies deterministically, or defers to the LLM (null).
 */

import { describe, it, expect } from 'vitest'
import { resolveBookingTurn, extractTime } from '../booking-flow.ts'

const TZ = 'America/Bogota'
const SERVICES = [{ id: 'svc-tarjeta', name: 'Tarjeta', duration_min: 30 }]
const OPEN_ALL: Record<string, [string, string]> = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'],
  thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: ['09:00', '18:00'],
  sun: ['09:00', '18:00'],
}

describe('extractTime', () => {
  it.each([
    ['a las 9 am', '09:00'],
    ['1 pm', '13:00'],
    ['13:00', '13:00'],
    ['a las 9', '09:00'],
    ['9 de la noche', '21:00'],
    ['mañana a las 9 am', '09:00'],
    ['a las 1:00 PM', '13:00'],
  ])('parses %s → %s', (input, expected) => {
    expect(extractTime(input)).toBe(expected)
  })

  it('returns null when no explicit time is present', () => {
    expect(extractTime('para mañana')).toBeNull()
    expect(extractTime('quiero agendar Tarjeta')).toBeNull()
  })
})

describe('resolveBookingTurn — (B) deterministic proposal', () => {
  it('proposes a validated confirmation question for service+date+time', () => {
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre a las 9 am',
      history: [],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: 'book_appointment',
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/^¿Confirmo tu cita de \*Tarjeta\*/)
      expect(turn.text).toContain('9:00 am')
    }
  })

  it('does NOT invent a time — defers (null) when no time given (time-gap layer handles it)', () => {
    // resolveBookingTurn returns null here; ai-agent then calls resolveBookingTimeGap.
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre',
      history: [],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: 'book_appointment',
    })
    expect(turn).toBeNull()
  })

  it('reports closed day instead of proposing', () => {
    const closedSun: Record<string, [string, string] | null> = { ...OPEN_ALL, thu: null, fri: null, sat: null, sun: null, mon: null, tue: null, wed: null }
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre a las 9 am',
      history: [],
      services: SERVICES,
      workingHours: closedSun,
      timezone: TZ,
      bookedSlots: [],
      intent: 'book_appointment',
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/cerrad/i)
  })

  it('returns null outside booking context (lets the LLM handle small talk)', () => {
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre a las 9 am',
      history: [],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: 'greeting',
    })
    expect(turn).toBeNull()
  })
})

describe('resolveBookingTurn — (A) deterministic execute on confirmation', () => {
  const proposalISO = '¿Confirmo tu cita de *Tarjeta* para el 2026-12-25 a las 1:00 PM?'
  const proposalHuman = '¿Confirmo tu cita de *Tarjeta* para el 25 de diciembre a las 9:00 am?'

  it('recovers an ISO-date proposal and executes with validated args', () => {
    const turn = resolveBookingTurn({
      userText: 'Si',
      history: [{ role: 'assistant', text: proposalISO }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: null,
    })
    expect(turn?.kind).toBe('execute')
    if (turn?.kind === 'execute') {
      expect(turn.serviceId).toBe('svc-tarjeta')
      expect(turn.date).toBe('2026-12-25')
      expect(turn.time).toBe('13:00')
    }
  })

  it('recovers a human-date proposal and executes', () => {
    const turn = resolveBookingTurn({
      userText: 'dale',
      history: [{ role: 'assistant', text: proposalHuman }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: null,
    })
    expect(turn?.kind).toBe('execute')
    if (turn?.kind === 'execute') expect(turn.time).toBe('09:00')
  })

  it('replies (not execute) when the slot was taken between proposal and confirmation', () => {
    const turn = resolveBookingTurn({
      userText: 'Si',
      history: [{ role: 'assistant', text: proposalISO }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      // Block 13:00–13:30 on 2026-12-25 (Bogota = UTC-5 → 18:00Z).
      bookedSlots: [{ start_at: '2026-12-25T18:00:00Z', end_at: '2026-12-25T18:30:00Z' }],
      intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/ocup|qued|otro/i)
  })

  it('returns null on a negative reply (no execute)', () => {
    const turn = resolveBookingTurn({
      userText: 'no',
      history: [{ role: 'assistant', text: proposalISO }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: null,
    })
    expect(turn).toBeNull()
  })

  it('returns null when the confirmation is for a non-booking proposal (cancel/reschedule)', () => {
    const turn = resolveBookingTurn({
      userText: 'Si',
      history: [{ role: 'assistant', text: '¿Confirmas que cancele tu cita de *Tarjeta* del 25 de diciembre a las 9:00 am?' }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: null,
    })
    expect(turn).toBeNull()
  })
})
