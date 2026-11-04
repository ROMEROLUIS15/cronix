import { beforeEach, describe, expect, it, vi } from 'vitest'
import { announceBookingEvent } from '@/lib/notifications/announce-booking-event'
import { logger } from '@/lib/logger'

const invoke = vi.fn()
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ functions: { invoke } }) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

describe('announceBookingEvent', () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.mocked(logger.error).mockClear()
  })

  it('sends only the action and the appointment id: the server reads the rest', async () => {
    invoke.mockResolvedValue({ error: null })

    await announceBookingEvent('rescheduled', 'apt-1')

    expect(invoke).toHaveBeenCalledWith('booking-event', { body: { action: 'rescheduled', appointmentId: 'apt-1' } })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs a failure and does not throw: the appointment is already saved', async () => {
    invoke.mockResolvedValue({ error: new Error('unreachable') })

    await expect(announceBookingEvent('created', 'apt-1')).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the call itself rejects', async () => {
    invoke.mockRejectedValue(new Error('offline'))

    await expect(announceBookingEvent('cancelled', 'apt-1')).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})

describe('bookingActionForEdit', () => {
  it.each([
    ['moving it', { start_at: '2026-11-06T11:00', status: 'pending' }, { start_at: '2026-11-06T15:00', status: 'pending' }, 'rescheduled'],
    ['moving it to another day', { start_at: '2026-11-06T11:00', status: 'confirmed' }, { start_at: '2026-11-07T11:00', status: 'confirmed' }, 'rescheduled'],
    ['cancelling it', { start_at: '2026-11-06T11:00', status: 'pending' }, { start_at: '2026-11-06T11:00', status: 'cancelled' }, 'cancelled'],
    ['moving and cancelling at once', { start_at: '2026-11-06T11:00', status: 'pending' }, { start_at: '2026-11-06T15:00', status: 'cancelled' }, 'cancelled'],
    ['saving it unchanged', { start_at: '2026-11-06T11:00', status: 'pending' }, { start_at: '2026-11-06T11:00', status: 'pending' }, null],
    ['only confirming it', { start_at: '2026-11-06T11:00', status: 'pending' }, { start_at: '2026-11-06T11:00', status: 'confirmed' }, null],
    ['saving one already cancelled', { start_at: '2026-11-06T11:00', status: 'cancelled' }, { start_at: '2026-11-06T11:00', status: 'cancelled' }, null],
  ])('%s', async (_label, before, after, expected) => {
    const { bookingActionForEdit } = await import('@/lib/use-cases/appointments.use-case')
    expect(bookingActionForEdit(before, after)).toBe(expected)
  })
})
