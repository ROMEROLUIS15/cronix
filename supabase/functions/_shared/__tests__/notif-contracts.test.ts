/**
 * notif-contracts.test.ts — Owner alert for a request the client has not confirmed yet
 * (operacion-canonica O3). The appointment is untouched; the owner just needs to know.
 */

import { describe, it, expect } from 'vitest'
import {
  buildChangeRequestEvent, buildTitle, buildContent, buildOwnerWhatsAppMessage, notificationKind, ownerWhenText,
} from '../notifications/notif-contracts.ts'

const BUSINESS = { id: 'biz-1', name: 'RS STUDIO' }
const RESCHEDULE = {
  type: 'reschedule' as const, appointmentId: 'apt-1', serviceName: 'Pestañas',
  date: '2026-10-24', time: '09:00', requestedDate: '2026-10-27',
}
const CANCEL = { ...RESCHEDULE, type: 'cancel' as const, requestedDate: null }

describe('buildChangeRequestEvent', () => {
  it('builds an idempotent reschedule-request event for the appointment slot', () => {
    expect(buildChangeRequestEvent(BUSINESS, 'Valeria', RESCHEDULE)).toEqual({
      eventId:       'reschedule_requested:biz-1:apt-1:2026-10-24:09:00',
      type:          'appointment.reschedule_requested',
      businessId:    'biz-1',
      businessName:  'RS STUDIO',
      clientName:    'Valeria',
      serviceName:   'Pestañas',
      date:          '2026-10-24',
      time:          '09:00',
      requestedDate: '2026-10-27',
      userId:        'whatsapp-agent',
      channel:       'whatsapp',
    })
  })

  it('builds a cancel-request event with its own id', () => {
    const event = buildChangeRequestEvent(BUSINESS, 'Valeria', CANCEL)
    expect(event.eventId).toBe('cancel_requested:biz-1:apt-1:2026-10-24:09:00')
    expect(event.type).toBe('appointment.cancel_requested')
    expect(event.requestedDate).toBeNull()
  })
})

describe('owner-facing texts for a pending request', () => {
  const reschedule = buildChangeRequestEvent(BUSINESS, 'Valeria', RESCHEDULE)
  const cancel     = buildChangeRequestEvent(BUSINESS, 'Valeria', CANCEL)

  it('titles say it is pending', () => {
    expect(buildTitle(reschedule.type)).toBe('Pidió reagendar (pendiente)')
    expect(buildTitle(cancel.type)).toBe('Pidió cancelar (pendiente)')
  })

  it('bell content names the appointment, the date asked for, and that it is not confirmed', () => {
    expect(buildContent(reschedule)).toBe('Pidió reagendar: Valeria — Pestañas el 2026-10-24 a las 09:00. Quiere el 2026-10-27. Aún no confirma.')
    expect(buildContent(cancel)).toBe('Pidió cancelar: Valeria — Pestañas el 2026-10-24 a las 09:00. Aún no confirma.')
  })

  it('the WhatsApp fallback tells the owner the appointment still stands', () => {
    const msg = buildOwnerWhatsAppMessage(reschedule)
    expect(msg).toContain('*Valeria* pidió reagendar su cita de *Pestañas*')
    expect(msg).toContain('Quiere: *2026-10-27*')
    expect(msg).toContain('la cita sigue en pie')
    expect(buildOwnerWhatsAppMessage(cancel)).toContain('*Valeria* pidió cancelar su cita de *Pestañas*')
  })

  it('the date parameter of the WhatsApp template carries the date asked for (it has only 4 fixed slots)', () => {
    expect(ownerWhenText(reschedule)).toBe('24 de octubre a las 9:00 am · quiere el 27 de octubre')
    expect(ownerWhenText(cancel)).toBe('24 de octubre a las 9:00 am')
    expect(ownerWhenText({ ...reschedule, type: 'appointment.created', requestedDate: undefined })).toBe('24 de octubre a las 9:00 am') // unchanged for O1
  })

  it('a cancel request is a warning, a reschedule request is info', () => {
    expect(notificationKind('appointment.cancel_requested')).toBe('warning')
    expect(notificationKind('appointment.reschedule_requested')).toBe('info')
    expect(notificationKind('appointment.cancelled')).toBe('warning')   // unchanged
    expect(notificationKind('appointment.created')).toBe('success')     // unchanged
    expect(notificationKind('appointment.rescheduled')).toBe('success') // unchanged
  })
})

describe('owner message for a created appointment', () => {
  it('says the channel the appointment was made through', () => {
    const created = {
      eventId: 'e1', type: 'appointment.created' as const, businessId: 'b1', businessName: 'Barbería',
      clientName: 'Ana', serviceName: 'Corte', date: '2030-06-17', time: '10:00', userId: 'phone-agent',
    }
    expect(buildOwnerWhatsAppMessage({ ...created, channel: 'phone' })).toContain('¡Reserva confirmada por teléfono!')
    expect(buildOwnerWhatsAppMessage({ ...created, channel: 'whatsapp' })).toContain('¡Reserva confirmada vía WhatsApp!')
  })
})
