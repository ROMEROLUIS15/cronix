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

  it('never invents a time — offers the real free slots when date given but no time', () => {
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre',
      history: [],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: 'book_appointment',
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/horarios libres|a qué hora/i)
      // crucially, it does NOT propose a confirmation with an invented time
      expect(turn.text).not.toMatch(/¿Confirmo/i)
    }
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

  it('does NOT execute on a negative reply — asks what to change (no re-propose)', () => {
    const turn = resolveBookingTurn({
      userText: 'no',
      history: [{ role: 'assistant', text: proposalISO }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      intent: null,
    })
    expect(turn?.kind).not.toBe('execute')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/cambiar|cambias/i)
  })

  it('executes a cancel confirmation (recovers the appointment from the proposal)', () => {
    const turn = resolveBookingTurn({
      userText: 'Si',
      history: [{ role: 'assistant', text: '¿Confirmas que cancele tu cita de *Tarjeta* del 25 de diciembre a las 9:00 am?' }],
      services: SERVICES,
      workingHours: OPEN_ALL,
      timezone: TZ,
      bookedSlots: [],
      activeAppointments: [{ id: 'apt-1', service_name: 'Tarjeta', start_at: '2026-12-25T14:00:00Z' }],
      intent: null,
    })
    expect(turn?.kind).toBe('executeCancel')
    if (turn?.kind === 'executeCancel') expect(turn.appointmentId).toBe('apt-1')
  })
})

describe('resolveBookingTurn — cancel flow', () => {
  const APPTS = [{ id: 'apt-1', service_name: 'Tarjeta', start_at: '2026-12-25T14:00:00Z' }] // 09:00 Bogota

  it('proposes a cancel confirmation for the single active appointment', () => {
    const turn = resolveBookingTurn({
      userText: 'quiero cancelar mi cita',
      history: [],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPTS, intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/cancele tu cita de \*Tarjeta\*/)
      expect(turn.text).toContain('9:00 am')
    }
  })

  it('lists appointments when there are several to cancel', () => {
    const turn = resolveBookingTurn({
      userText: 'cancelar',
      history: [],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: [
        { id: 'apt-1', service_name: 'Tarjeta', start_at: '2026-12-25T14:00:00Z' },
        { id: 'apt-2', service_name: 'Corte',   start_at: '2026-12-26T15:00:00Z' },
      ],
      intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/varias citas/i)
  })

  it('informs when there is nothing to cancel', () => {
    const turn = resolveBookingTurn({
      userText: 'cancelar mi cita',
      history: [],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/no veo ninguna cita/i)
  })
})

describe('resolveBookingTurn — reschedule flow', () => {
  const APPTS = [{ id: 'apt-1', service_name: 'Tarjeta', start_at: '2026-12-25T14:00:00Z' }] // 09:00 Bogota

  it('proposes a validated reschedule when new date+time are given', () => {
    const turn = resolveBookingTurn({
      userText: 'reagenda mi cita para el 26 de diciembre a las 10 am',
      history: [],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPTS, intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/¿Reagendo tu cita de \*Tarjeta\* del 25 de diciembre al 26 de diciembre/)
      expect(turn.text).toContain('10:00 am')
    }
  })

  it('asks for the time when only a new date is given', () => {
    const turn = resolveBookingTurn({
      userText: 'reagenda mi cita para el 26 de diciembre',
      history: [],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPTS, intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/a qué hora/i)
  })

  it('executes a reschedule confirmation (recovers appt + new slot from the proposal)', () => {
    const turn = resolveBookingTurn({
      userText: 'dale',
      history: [{ role: 'assistant', text: '¿Reagendo tu cita de *Tarjeta* del 25 de diciembre al 26 de diciembre a las 10:00 am?' }],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPTS, intent: null,
    })
    expect(turn?.kind).toBe('executeReschedule')
    if (turn?.kind === 'executeReschedule') {
      expect(turn.appointmentId).toBe('apt-1')
      expect(turn.newDate).toBe('2026-12-26')
      expect(turn.newTime).toBe('10:00')
    }
  })
})

// ── Anti-hallucination: the client's stated date/time always wins ──────────────
describe('resolveBookingTurn — state machine owns booking, never trusts the proposal', () => {
  it('re-proposes with the CLIENT\'s new date, ignoring a stale/invented proposal', () => {
    const turn = resolveBookingTurn({
      userText: 'mejor el 25 de diciembre a las 11 am',
      history: [
        { role: 'user', text: 'quiero agendar' },
        { role: 'assistant', text: '¿Confirmo tu cita de *Tarjeta* para el 24 de diciembre a las 10:00 am?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/25 de diciembre/)
      expect(turn.text).toContain('11:00 am')
      expect(turn.text).not.toMatch(/24 de diciembre/) // never keeps the stale date
    }
  })

  it('executes the CLIENT-stated date/time, not the (possibly invented) proposal text', () => {
    const turn = resolveBookingTurn({
      userText: 'Si',
      history: [
        { role: 'user', text: 'quiero agendar' },
        { role: 'user', text: 'el 25 de diciembre a las 11 am' },
        // proposal carries a WRONG date (24) — must be ignored in favour of what the client said.
        { role: 'assistant', text: '¿Confirmo tu cita de *Tarjeta* para el 24 de diciembre a las 11:00 am?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('execute')
    if (turn?.kind === 'execute') {
      expect(turn.date).toBe('2026-12-25') // the client's date, NOT 24
      expect(turn.time).toBe('11:00')
    }
  })

  it('stays in booking context after a service-clarification sub-turn (single service)', () => {
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre a las 11 am',
      history: [
        { role: 'user', text: 'para agendar' },
        { role: 'assistant', text: 'Con gusto te agendo *Tarjeta*. ¿Para qué día y a qué hora te gustaría?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/¿Confirmo tu cita de \*Tarjeta\* para el 25 de diciembre a las 11:00 am/)
    }
  })

  it('asks for day+time first (single service) without inventing anything', () => {
    const turn = resolveBookingTurn({
      userText: 'para agendar',
      history: [], services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      intent: 'book_appointment',
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/qué día y a qué hora/i)
      expect(turn.text).not.toMatch(/¿Confirmo/i)
    }
  })
})
