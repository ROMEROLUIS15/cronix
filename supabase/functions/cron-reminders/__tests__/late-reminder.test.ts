/**
 * late-reminder.test.ts — The client reminder for an appointment booked or moved too late
 * for that night's 20:00 run.
 *
 * Measured in prod (2026-11-07, 180 days, real businesses): 8 of 220 appointments were
 * created after 20:00 the night before, so no reminder ever went out for them.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  handleLateReminder, isLateForTonight, parseLateReminder,
  type LateReminderDeps, type LateReminderRequest,
} from '../modules/late-reminder.ts'
import type { AppointmentWithClient, BusinessRow } from '../types.ts'

const CARACAS = 'America/Caracas' // UTC-4, no daylight saving
const MADRID = 'Europe/Madrid'    // UTC+1 in November

describe('isLateForTonight', () => {
  const tomorrowAt10 = '2026-11-07T14:00:00Z' // Sat 7 Nov, 10:00 in Caracas

  it.each([
    ['19:56, the run already went out', '2026-11-06T23:56:00Z', tomorrowAt10, true],
    ['19:55 exactly, just before the run', '2026-11-06T23:55:00Z', tomorrowAt10, true],
    ['19:54, the 20:00 run still covers it', '2026-11-06T23:54:00Z', tomorrowAt10, false],
    ['23:30, for tomorrow at 20:30', '2026-11-07T03:30:00Z', '2026-11-08T00:30:00Z', true],
    ['00:30 for the same day', '2026-11-07T04:30:00Z', tomorrowAt10, false],
    ['19:56 for the day after tomorrow', '2026-11-06T23:56:00Z', '2026-11-08T14:00:00Z', false],
  ])('Caracas, %s → %s', (_label, now, startAt, expected) => {
    expect(isLateForTonight(startAt, CARACAS, new Date(now))).toBe(expected)
  })

  it('reads the business timezone, not UTC: Madrid at 20:00 and at 19:50', () => {
    const tomorrowAt10Madrid = '2026-11-07T09:00:00Z'
    expect(isLateForTonight(tomorrowAt10Madrid, MADRID, new Date('2026-11-06T19:00:00Z'))).toBe(true)
    expect(isLateForTonight(tomorrowAt10Madrid, MADRID, new Date('2026-11-06T18:50:00Z'))).toBe(false)
  })
})

describe('parseLateReminder', () => {
  it('reads the request', () => {
    expect(parseLateReminder({ lateReminder: { businessId: 'b', appointmentId: 'a', rescheduled: true } }))
      .toEqual({ businessId: 'b', appointmentId: 'a', rescheduled: true })
  })

  it('treats a missing flag as a new booking', () => {
    expect(parseLateReminder({ lateReminder: { businessId: 'b', appointmentId: 'a' } }))
      .toEqual({ businessId: 'b', appointmentId: 'a', rescheduled: false })
  })

  it.each([
    ['the hourly pg_cron body', {}],
    ['no body', null],
    ['an empty id', { lateReminder: { businessId: 'b', appointmentId: '' } }],
    ['a non-string id', { lateReminder: { businessId: 'b', appointmentId: 7 } }],
  ])('is not a late request: %s', (_label, body) => {
    expect(parseLateReminder(body)).toBeNull()
  })
})

describe('handleLateReminder', () => {
  const NOW = new Date('2026-11-07T02:30:00Z') // Fri 6 Nov, 22:30 in Caracas
  const BUSINESS: BusinessRow = { id: 'biz-1', name: 'Studio', timezone: CARACAS, phone: null, settings: null }
  const APPOINTMENT = {
    id: 'apt-1', start_at: '2026-11-07T14:00:00Z', service_id: 's1', status: 'confirmed',
    services: { name: 'Cejas' }, clients: { name: 'Ana', phone: '+584120000001' },
  }
  const REQUEST: LateReminderRequest = { businessId: 'biz-1', appointmentId: 'apt-1', rescheduled: false }

  function deps(overrides: Partial<LateReminderDeps> = {}) {
    return {
      loadBusiness: vi.fn(async () => BUSINESS),
      loadAppointment: vi.fn(async () => APPOINTMENT),
      skippedIds: vi.fn(async () => new Set<string>()),
      send: vi.fn(async () => ({ sent: 1, failed: 0, failedAppointments: [] as AppointmentWithClient[] })),
      ...overrides,
    } satisfies LateReminderDeps
  }

  it('sends the reminder of tomorrow\'s appointment booked at 22:30', async () => {
    const d = deps()

    const result = await handleLateReminder(REQUEST, d, NOW)

    expect(result).toEqual({ outcome: 'sent', failedAppointments: [] })
    expect(d.loadAppointment).toHaveBeenCalledWith('biz-1', 'apt-1')
    expect(d.skippedIds).toHaveBeenCalledWith('biz-1', 'apt-1', { resend: false })
    expect(d.send).toHaveBeenCalledWith(BUSINESS, APPOINTMENT, new Set())
  })

  it('sends nothing before 19:55: the 20:00 run covers it', async () => {
    const d = deps()

    const result = await handleLateReminder(REQUEST, d, new Date('2026-11-06T22:00:00Z'))

    expect(result.outcome).toBe('not_late')
    expect(d.send).not.toHaveBeenCalled()
  })

  it.each([
    ['cancelled', 'cancelled'],
    ['no_show', 'no_show'],
  ])('sends nothing for a %s appointment', async (_label, status) => {
    const d = deps({ loadAppointment: vi.fn(async () => ({ ...APPOINTMENT, status })) })

    expect((await handleLateReminder(REQUEST, d, NOW)).outcome).toBe('not_found')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('sends nothing when the appointment is not in that business', async () => {
    const d = deps({ loadAppointment: vi.fn(async () => null) })

    expect((await handleLateReminder(REQUEST, d, NOW)).outcome).toBe('not_found')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('sends nothing for an unknown business', async () => {
    const d = deps({ loadBusiness: vi.fn(async () => null) })

    expect((await handleLateReminder(REQUEST, d, NOW)).outcome).toBe('not_found')
    expect(d.loadAppointment).not.toHaveBeenCalled()
  })

  it('does not send a second reminder for a booking that already got tonight\'s', async () => {
    const d = deps({ skippedIds: vi.fn(async () => new Set(['apt-1'])) })

    expect((await handleLateReminder(REQUEST, d, NOW)).outcome).toBe('skipped')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('a move resends: tonight\'s reminder told the client the old time', async () => {
    const d = deps()

    await handleLateReminder({ ...REQUEST, rescheduled: true }, d, NOW)

    expect(d.skippedIds).toHaveBeenCalledWith('biz-1', 'apt-1', { resend: true })
    expect(d.send).toHaveBeenCalledTimes(1)
  })

  it('reports a failed send with the appointment, for the owner\'s bell', async () => {
    const failed = [APPOINTMENT as AppointmentWithClient]
    const d = deps({ send: vi.fn(async () => ({ sent: 0, failed: 1, failedAppointments: failed })) })

    expect(await handleLateReminder(REQUEST, d, NOW)).toEqual({ outcome: 'failed', failedAppointments: failed })
  })

  it('reports skipped when nothing went out (WhatsApp off for the business, or no phone)', async () => {
    const d = deps({ send: vi.fn(async () => ({ sent: 0, failed: 0, failedAppointments: [] })) })

    expect((await handleLateReminder(REQUEST, d, NOW)).outcome).toBe('skipped')
  })
})
