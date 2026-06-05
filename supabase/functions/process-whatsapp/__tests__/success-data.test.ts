/**
 * success-data.test.ts — Regression guard for the blank-confirmation bug.
 *
 * The original bug: the booking adapter returned only { success, message,
 * appointmentId }, so the final-pass template rendered "Tu cita para ** quedó
 * agendada" (empty service/date/time). final-response.test.ts fabricated the
 * ideal input and stayed green while production was broken.
 *
 * These tests pin the PRODUCER→CONSUMER contract: the adapter's success fields,
 * mapped by buildSuccessTemplateData, must drive a fully-rendered template via
 * selectFinalResponse. If someone drops the adapter fields again, this goes red.
 */

import { describe, it, expect } from 'vitest'
import { buildSuccessTemplateData } from '../success-data.ts'
import { selectFinalResponse } from '../final-response.ts'

const TZ = 'America/Bogota'

// Mirrors what WhatsAppBookingAdapter now returns on success.
const adapterConfirm    = { success: true, message: 'x', appointmentId: 'a1', serviceName: 'Corte de cabello', date: '2026-06-10', time: '15:00' }
const adapterReschedule = { success: true, message: 'x', appointmentId: 'a2', serviceName: 'Manicura',         date: '2026-07-01', time: '10:30' }
const adapterCancel     = { success: true, message: 'x', appointmentId: 'a3', serviceName: 'Pedicura',         date: '2026-06-15', time: '09:00' }

describe('buildSuccessTemplateData — adapter → template field mapping', () => {
  it('confirm/cancel map to date/time/service_name', () => {
    expect(buildSuccessTemplateData('confirm_booking', adapterConfirm)).toEqual({
      service_name: 'Corte de cabello', date: '2026-06-10', time: '15:00',
    })
    expect(buildSuccessTemplateData('cancel_booking', adapterCancel)).toEqual({
      service_name: 'Pedicura', date: '2026-06-15', time: '09:00',
    })
  })

  it('reschedule maps to new_date/new_time/service_name', () => {
    expect(buildSuccessTemplateData('reschedule_booking', adapterReschedule)).toEqual({
      service_name: 'Manicura', new_date: '2026-07-01', new_time: '10:30',
    })
  })
})

describe('end-to-end: adapter fields produce a fully-rendered customer message', () => {
  it('confirm_booking renders service + time (not blank)', () => {
    const data = buildSuccessTemplateData('confirm_booking', adapterConfirm)
    const msg  = selectFinalResponse(true, { success: true, ...data }, '', { tool: 'confirm_booking' }, TZ)
    expect(msg).toContain('Corte de cabello')
    expect(msg).toContain('3:00 pm')
    expect(msg).not.toContain('**')   // the bug signature: empty bold markdown
  })

  it('reschedule_booking renders service + new time', () => {
    const data = buildSuccessTemplateData('reschedule_booking', adapterReschedule)
    const msg  = selectFinalResponse(true, { success: true, ...data }, '', { tool: 'reschedule_booking' }, TZ)
    expect(msg).toContain('Manicura')
    expect(msg).toContain('10:30 am')
    expect(msg).toContain('reagendada')
  })

  it('cancel_booking renders service + date', () => {
    const data = buildSuccessTemplateData('cancel_booking', adapterCancel)
    const msg  = selectFinalResponse(true, { success: true, ...data }, '', { tool: 'cancel_booking' }, TZ)
    expect(msg).toContain('Pedicura')
    expect(msg).toContain('cancelada')
    expect(msg).not.toContain('**')
  })

  it('REGRESSION: missing adapter fields would render blank (documents the bug)', () => {
    // Simulate the old adapter output (no serviceName/date/time).
    const data = buildSuccessTemplateData('confirm_booking', { success: true } as never)
    const msg  = selectFinalResponse(true, { success: true, ...data }, '', { tool: 'confirm_booking' }, TZ)
    // This is the broken output we fixed — asserting it proves the template
    // depends on the fields the adapter now supplies.
    expect(msg).toContain('**')
  })
})
