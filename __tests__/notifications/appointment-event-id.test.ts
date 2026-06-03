import { describe, it, expect } from 'vitest'
import { buildAppointmentEventId } from '@/lib/notifications/appointment-event-id'

/**
 * Guards the unified notification contract. The Deno source of truth lives at
 * supabase/functions/_shared/notifications/event-id.ts; this Node mirror MUST
 * produce byte-identical output (ADR-0008 manual-sync seam). If either side
 * changes the format, cross-channel idempotency via notifications.event_id breaks.
 */
describe('buildAppointmentEventId — unified notification contract', () => {
  it('produces the canonical {action}:{businessId}:{appointmentId}:{date}:{time} format', () => {
    expect(buildAppointmentEventId('created', 'biz-1', 'appt-9', '2026-06-10', '15:00'))
      .toBe('created:biz-1:appt-9:2026-06-10:15:00')
  })

  it('is deterministic — same inputs yield the same id (the idempotency key)', () => {
    const a = buildAppointmentEventId('rescheduled', 'b', 'a', '2026-01-01', '09:30')
    const b = buildAppointmentEventId('rescheduled', 'b', 'a', '2026-01-01', '09:30')
    expect(a).toBe(b)
  })

  it('distinguishes action, appointment, date and time', () => {
    const base = buildAppointmentEventId('created', 'b', 'a', '2026-01-01', '09:00')
    expect(buildAppointmentEventId('cancelled', 'b', 'a',  '2026-01-01', '09:00')).not.toBe(base)
    expect(buildAppointmentEventId('created',   'b', 'a2', '2026-01-01', '09:00')).not.toBe(base)
    expect(buildAppointmentEventId('created',   'b', 'a',  '2026-01-02', '09:00')).not.toBe(base)
    expect(buildAppointmentEventId('created',   'b', 'a',  '2026-01-01', '10:00')).not.toBe(base)
  })

  it('matches the Deno _shared contract byte-for-byte (drift guard)', () => {
    expect(buildAppointmentEventId('cancelled', 'B', 'A', '2026-12-31', '23:45'))
      .toBe('cancelled:B:A:2026-12-31:23:45')
  })
})
