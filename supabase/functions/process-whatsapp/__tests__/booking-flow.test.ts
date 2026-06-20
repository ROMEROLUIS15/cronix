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

// ── Reschedule sticky multi-turn — the LLM never owned this; it must write end-to-end.
describe('resolveBookingTurn — reschedule (enclitic + sticky sub-dialogue + misma hora)', () => {
  const APPT = [{ id: 'apt-1', service_name: 'Tarjeta', start_at: '2026-12-25T14:00:00Z' }] // 09:00 Bogota

  it('matches an enclitic "reagendarla" instead of dropping to the LLM', () => {
    const turn = resolveBookingTurn({
      userText: 'quiero reagendarla',
      history: [], services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPT, intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') expect(turn.text).toMatch(/nueva fecha quieres reagendar/i)
  })

  it('stays in reschedule context across turns and resolves "a la misma hora"', () => {
    const turn = resolveBookingTurn({
      userText: 'para el 26 de diciembre a la misma hora',
      history: [
        { role: 'user', text: 'quiero reagendarla' },
        { role: 'assistant', text: '¿Para qué nueva fecha quieres reagendar tu cita de *Tarjeta*?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPT, intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/¿Reagendo tu cita de \*Tarjeta\* del 25 de diciembre al 26 de diciembre/)
      expect(turn.text).toContain('9:00 am') // keeps the original 09:00
    }
  })

  it('keeps reschedule context after a CLOSED-DAY retry (does not fall to new-booking)', () => {
    const closedFri: Record<string, [string, string] | null> = { ...OPEN_ALL, fri: null } // 2026-12-25 = Friday
    const turn = resolveBookingTurn({
      userText: 'para el 26 de diciembre',
      history: [
        { role: 'user', text: 'quiero reagendarla' },
        { role: 'assistant', text: '¿Para qué nueva fecha quieres reagendar tu cita de *Tarjeta*?' },
        { role: 'user', text: 'el 25 de diciembre a las 10' },
        { role: 'assistant', text: 'Lo siento, el 25 de diciembre el negocio está cerrado. ¿Para qué otra fecha reagendamos tu cita de *Tarjeta*?' },
      ],
      services: SERVICES, workingHours: closedFri, timezone: TZ, bookedSlots: [],
      activeAppointments: APPT, intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).not.toMatch(/Qué servicio deseas/i)            // did NOT lose context
      expect(turn.text).toMatch(/¿Reagendo tu cita de \*Tarjeta\* del 25 de diciembre al 26 de diciembre/)
    }
  })

  it('executes once the deterministic proposal is confirmed (no silent no-op)', () => {
    const turn = resolveBookingTurn({
      userText: 'si',
      history: [
        { role: 'user', text: 'quiero reagendarla' },
        { role: 'assistant', text: '¿Para qué nueva fecha quieres reagendar tu cita de *Tarjeta*?' },
        { role: 'user', text: 'para el 26 de diciembre a la misma hora' },
        { role: 'assistant', text: '¿Reagendo tu cita de *Tarjeta* del 25 de diciembre al 26 de diciembre a las 9:00 am?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [],
      activeAppointments: APPT, intent: null,
    })
    expect(turn?.kind).toBe('executeReschedule')
    if (turn?.kind === 'executeReschedule') {
      expect(turn.appointmentId).toBe('apt-1')
      expect(turn.newDate).toBe('2026-12-26')
      expect(turn.newTime).toBe('09:00')
    }
  })
})

// ── Bare-number ambiguity (day vs hour) resolved by conversational context. ────
describe('resolveBookingTurn — bare number is the HOUR when answering the time', () => {
  it('a bare "10" after offering slots keeps the locked date (not day-of-month)', () => {
    const turn = resolveBookingTurn({
      userText: '10',
      history: [
        { role: 'user', text: 'quiero agendar' },
        { role: 'assistant', text: 'Con gusto te agendo *Tarjeta*. ¿Para qué día y a qué hora te gustaría?' },
        { role: 'user', text: 'el 25 de diciembre' },
        { role: 'assistant', text: 'Para el 25 de diciembre tengo estos horarios libres para *Tarjeta*: 9:00 am, 9:30 am, 10:00 am. ¿A qué hora te viene bien?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/¿Confirmo tu cita de \*Tarjeta\* para el 25 de diciembre a las 10:00 am/)
      expect(turn.text).not.toMatch(/julio|enero|noviembre/) // never shifted to "day 10"
    }
  })

  it('answering only the day offers the slots — never scolds "no entendí la hora"', () => {
    const turn = resolveBookingTurn({
      userText: 'el 25 de diciembre',
      history: [
        { role: 'user', text: 'quiero agendar' },
        { role: 'assistant', text: 'Con gusto te agendo *Tarjeta*. ¿Para qué día y a qué hora te gustaría?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/horarios libres|a qué hora te viene/i)
      expect(turn.text).not.toMatch(/no te entend/i)
    }
  })
})

// ── Bug 2: accent-insensitive service recognition. ─────────────────────────────
describe('resolveBookingTurn — service recognition is accent-insensitive', () => {
  const SVCS = [
    { id: 'svc-t', name: 'Tarjeta',     duration_min: 30 },
    { id: 'svc-e', name: 'Electrónica', duration_min: 30 },
  ]
  it('recognizes "electronica" (no accent) as Electrónica and advances', () => {
    const turn = resolveBookingTurn({
      userText: 'para electronica',
      history: [
        { role: 'user', text: 'quiero agendar una cita' },
        { role: 'assistant', text: 'Con gusto te ayudo a agendar. ¿Qué servicio deseas? Tenemos: Tarjeta, Electrónica.' },
      ],
      services: SVCS, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/Electrónica/)
      expect(turn.text).not.toMatch(/¿Qué servicio deseas/i) // recognized → did not re-ask
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

  it('a COMPLETED booking ends booking context (a later read query is not hijacked)', () => {
    const turn = resolveBookingTurn({
      userText: 'quiero saber si tengo citas disponibles',
      history: [
        { role: 'user', text: 'para agendar' },
        { role: 'assistant', text: '¿Confirmo tu cita de *Tarjeta* para el 22 de diciembre a las 3:00 pm?' },
        { role: 'user', text: 'si' },
        { role: 'assistant', text: '✅ ¡Listo! Tu cita para *Tarjeta* quedó agendada para el 22 de diciembre a las 3:00 pm.' },
        { role: 'user', text: 'hola' },
        { role: 'assistant', text: '¡Hola! 👋 Soy el asistente virtual de IGM. ¿En qué puedo servirte?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn).toBeNull() // booking layer yields → list-appointments handles the read
  })

  it('does NOT pull a stale date from a PREVIOUS (completed) booking in history', () => {
    const turn = resolveBookingTurn({
      userText: 'quiero agendar',
      history: [
        { role: 'user', text: 'el 23 de diciembre a las 11 am' },
        { role: 'assistant', text: '✅ ¡Listo! Tu cita para *Tarjeta* quedó agendada para el 23 de diciembre a las 11:00 am.' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: 'book_appointment',
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/qué día y a qué hora/i)
      expect(turn.text).not.toMatch(/23 de diciembre/) // the stale date must NOT leak in
    }
  })

  it('understands "el 21" / bare day after asking the day (no loop, advances to time)', () => {
    const turn = resolveBookingTurn({
      userText: 'el 21',
      history: [
        { role: 'user', text: 'para agendar' },
        { role: 'assistant', text: 'Con gusto te agendo *Tarjeta*. ¿Para qué día y a qué hora te gustaría?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      // advanced to time (offers slots), did NOT re-ask the day
      expect(turn.text).toMatch(/horarios libres|a qué hora/i)
      expect(turn.text).not.toMatch(/¿Para qué día/i)
    }
  })

  it('says "no entendí la fecha" with examples instead of repeating the question', () => {
    const turn = resolveBookingTurn({
      userText: 'xyzzy',
      history: [
        { role: 'user', text: 'para agendar' },
        { role: 'assistant', text: 'Con gusto te agendo *Tarjeta*. ¿Para qué día y a qué hora te gustaría?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/no te entend[íi] la fecha/i)
      expect(turn.text).toMatch(/el 21|mañana|el lunes/i) // gives examples
    }
  })

  it('bounds gathering to the current booking intent (ignores an earlier abandoned date)', () => {
    const turn = resolveBookingTurn({
      userText: 'a las 2 pm',
      history: [
        { role: 'user', text: 'el 23 de diciembre a las 11 am' },                                   // stale, abandoned
        { role: 'assistant', text: '¿Confirmo tu cita de *Tarjeta* para el 23 de diciembre a las 11:00 am?' },
        { role: 'user', text: 'quiero agendar otra' },                                               // fresh intent
        { role: 'assistant', text: 'Con gusto te agendo *Tarjeta*. ¿Para qué día y a qué hora te gustaría?' },
      ],
      services: SERVICES, workingHours: OPEN_ALL, timezone: TZ, bookedSlots: [], intent: null,
    })
    expect(turn?.kind).toBe('reply')
    if (turn?.kind === 'reply') {
      expect(turn.text).toMatch(/qué día/i)              // asks the day (time given, date not)
      expect(turn.text).not.toMatch(/23 de diciembre/)   // stale date excluded
    }
  })
})
