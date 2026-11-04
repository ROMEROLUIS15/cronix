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
import { hasBookingIntent } from '../../supabase/functions/voice-worker/core/conversation/slot-extractor'
import { executeSchedule } from '../../supabase/functions/voice-worker/capabilities/schedule/tool'
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

describe('hasBookingIntent', () => {
  it.each([
    'agéndale a Sim Tester una cita de E2E Service el 6 de noviembre a las 11',
    'agenda a Luis para mañana a las 3',
    'Agendaré Sim tester una cita de E2E Service',
    'agendar a Ana el viernes',
    'reserva una cita para Ana',
    'programa a Pedro el lunes',
    'aparta el martes para María',
    'anota a Luis mañana',
    'crea una cita para Ana',
    'una cita para Ana mañana a las 3',
    'Sim Tester quiere una cita de E2E Service el viernes',
    'necesito otra cita para Luis',
    'nueva cita para Ana',
    'cita para Ana mañana',
  ])('accepts "%s"', (text) => {
    expect(hasBookingIntent(text)).toBe(true)
  })

  it.each([
    'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde',
    'cambia la cita de Sim Tester para las 4',
    'mueve la cita de Ana a las 3',
    'reagenda la cita de Ana para las 5',
    'reprograma la cita de Ana',
    'la cita de Ana a las 3',
    'cancela la cita de Ana',
  ])('rejects "%s": it does not ask for a new appointment', (text) => {
    expect(hasBookingIntent(text)).toBe(false)
  })
})

describe('smart_schedule', () => {
  it('asks instead of booking when the sentence does not request a new appointment', async () => {
    const ctx = {
      timezone: 'America/Caracas',
      userTextCorpus: 'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde',
      // Any database access would throw: the guard runs before the first read.
      supabase: new Proxy({}, { get() { throw new Error('touched the database') } }),
    } as unknown as ToolContext

    const result = await executeSchedule(ctx, { service_name: 'E2E Service', client_name: 'Sim Tester', date: '2026-11-06', time: '16:00' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('GUARD_REJECTED')
    expect(result.result).toContain('una cita nueva')
  })
})
