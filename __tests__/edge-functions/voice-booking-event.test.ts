// @vitest-environment node
/**
 * The dashboard voice button uses the same pipeline as WhatsApp, and it does not book unless the
 * sentence asks for it: "Cambia la cita" misheard as "E2E la cita" created a new appointment
 * and answered "Listo" (measured in production, 2026-11-04).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toBookingEvent } from '../../supabase/functions/voice-worker/booking-event'
import { refersToExistingAppointment } from '../../supabase/functions/voice-worker/core/conversation/slot-extractor'
import { executeSchedule } from '../../supabase/functions/voice-worker/capabilities/schedule/tool'
import { detectListAppointments } from '../../supabase/functions/voice-worker/capabilities/list-appointments/fast-path'
import type { ToolContext } from '../../supabase/functions/voice-worker/core/tool-context'

const NOTIFICATION = {
  eventId: 'rescheduled:biz:appt:2026-11-06:15:00',
  type: 'appointment.rescheduled' as const,
  businessId: 'biz',
  userId: 'user-1',
  clientName: 'Ana',
  serviceName: 'Cejas',
  date: '2026-11-06',
  time: '15:00',
}

describe('voice button event', () => {
  it('keeps the data of the write and says it came from voice', () => {
    expect(toBookingEvent(NOTIFICATION, 'Studio', 'owner')).toEqual({
      ...NOTIFICATION, businessName: 'Studio', channel: 'voice', ownerActed: true,
    })
  })

  it.each([
    ['owner', true],
    ['platform_admin', true],
    ['employee', false],
  ])('a %s using the button sets ownerActed=%s', (role, ownerActed) => {
    expect(toBookingEvent(NOTIFICATION, 'Studio', role).ownerActed).toBe(ownerActed)
  })

  it('has no notification code of its own left', () => {
    const index = readFileSync(path.resolve(__dirname, '../../supabase/functions/voice-worker/index.ts'), 'utf8')
    expect(index).toContain('emitBookingEvent')
    expect(index).not.toContain('dispatchBellNotification')
  })
})

describe('refersToExistingAppointment', () => {
  it.each([
    'agéndale a Sim Tester una cita de E2E Service el 6 de noviembre a las 11',
    'agenda a Luis para mañana a las 3',
    'agendar a Ana el viernes',
    'agenda la cita de Ana para mañana',
    'reserva una cita para Ana',
    'programa a Pedro el lunes',
    'crea una cita para Ana',
    'una cita para Ana mañana a las 3',
    'Sim Tester quiere una cita de E2E Service el viernes',
    'quiero cita para Ana mañana a las 3 corte',
    'necesito cita para Ana',
    'dame cita para Ana mañana',
    'ponle cita a Ana mañana',
    'sácale cita a Ana',
    'cita nueva para Ana',
    'cita para Ana mañana',
    'dame un turno para Ana mañana',
    'apúntame a Ana mañana',
    'y a Carlos mañana a las 5 para corte',
    'entonces a Ana mañana a las 4 para corte',
    'dale a las 3 para Ana, corte, mañana',
    'nueva',
    'una nueva',
    'sí, nueva',
    'sí',
    'mañana a las 3',
  ])('books: "%s"', (text) => {
    expect(refersToExistingAppointment(text)).toBe(false)
  })

  it.each([
    'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde',
    'cambia la cita de Sim Tester para las 4',
    'cambia una cita de Ana para las 4',
    'mueve la cita de Ana a las 3',
    'reagenda la cita de Ana para las 5',
    're agenda la cita de Ana',
    'reprograma la cita de Ana',
    'adelanta la cita de Ana',
    'la cita de Ana a las 3',
    'mi cita para las 3',
    'mover',
  ])('does not book: "%s"', (text) => {
    expect(refersToExistingAppointment(text)).toBe(true)
  })
})

describe('smart_schedule', () => {
  const db = new Proxy({}, { get() { throw new Error('touched the database') } })

  it('asks instead of booking when the turn points at an existing appointment', async () => {
    const text = 'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde'
    const ctx = { timezone: 'America/Caracas', userTurn: text, userTextCorpus: text, supabase: db } as unknown as ToolContext

    const result = await executeSchedule(ctx, { service_name: 'E2E Service', client_name: 'Sim Tester', date: '2026-11-06', time: '16:00' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('GUARD_REJECTED')
    expect(result.result).toContain('una cita nueva')
  })

  it('looks at this turn only: answering "nueva" to its own question gets past the guard', async () => {
    const earlier = 'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde para E2E Service'
    const ctx = { timezone: 'America/Caracas', userTurn: 'nueva', userTextCorpus: `nueva ${earlier}`, supabase: db } as unknown as ToolContext

    // Past the guard the tool reads the catalog, which is what this database refuses.
    await expect(executeSchedule(ctx, { service_name: 'E2E Service', client_name: 'Sim Tester', date: '2026-11-06', time: '16:00' })).rejects.toThrow('touched the database')
  })
})

describe('"agenda": a command or the calendar', () => {
  const today = '2026-11-04'

  it.each([
    'agenda una cita para Sim Tester de E2E Service el 6 de noviembre a las 11 de la mañana',
    'Agenda Sim tester el 7 de noviembre a las 2 de la tarde para E 12 Service',
    'agenda a Ana mañana a las 3',
    'agenda al señor Pérez hoy a las 5',
  ])('"%s" is a command: it does not answer with the day\'s list', (text) => {
    expect(detectListAppointments(text, today)).toBeNull()
  })

  it.each([
    ['agenda de hoy', '2026-11-04'],
    ['agenda de mañana', '2026-11-05'],
    ['agenda para mañana', '2026-11-05'],
    ['mi agenda del 6 de noviembre', '2026-11-06'],
    ['muéstrame la agenda de hoy', '2026-11-04'],
    ['agenda hoy', '2026-11-04'],
    ['qué citas tengo hoy', '2026-11-04'],
  ])('"%s" still reads the calendar', (text, date) => {
    expect(detectListAppointments(text, today)).toEqual({ date })
  })
})
