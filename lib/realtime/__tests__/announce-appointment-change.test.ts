/**
 * announceAppointmentChange — the web's Broadcast after an appointment write.
 */
import { describe, expect, it, vi } from 'vitest'
import { announceAppointmentChange, APPOINTMENT_CHANGED } from '../announce-appointment-change'

function fakeSupabase(openTopics: string[] = []) {
  const channel = { topic: 'realtime:notifications:b1', httpSend: vi.fn().mockResolvedValue({ success: true }) }
  return {
    channel: vi.fn().mockReturnValue(channel),
    getChannels: vi.fn().mockReturnValue(openTopics.map((topic) => ({ topic }))),
    removeChannel: vi.fn().mockResolvedValue('ok'),
    sent: channel,
  }
}

describe('announceAppointmentChange', () => {
  it('sends appointment.changed by REST on the business channel and removes the channel it opened', async () => {
    const supabase = fakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await announceAppointmentChange(supabase as any, 'b1')
    expect(supabase.channel).toHaveBeenCalledWith('notifications:b1')
    expect(supabase.sent.httpSend).toHaveBeenCalledWith(APPOINTMENT_CHANGED, {})
    expect(supabase.removeChannel).toHaveBeenCalledWith(supabase.sent)
  })

  it('keeps a channel the dashboard already had open (channel() returns that same one)', async () => {
    const supabase = fakeSupabase(['realtime:notifications:b1'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await announceAppointmentChange(supabase as any, 'b1')
    expect(supabase.sent.httpSend).toHaveBeenCalled()
    expect(supabase.removeChannel).not.toHaveBeenCalled()
  })

  it('never throws: a failed broadcast only delays the refresh until the poll', async () => {
    const supabase = fakeSupabase()
    supabase.sent.httpSend.mockRejectedValue(new Error('network'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(announceAppointmentChange(supabase as any, 'b1')).resolves.toBeUndefined()
  })
})
