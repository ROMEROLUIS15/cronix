import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  upsertReminder,
  cancelRemindersByAppointment,
  getPendingReminders,
  markReminderSent,
  markReminderFailed,
  getAppointmentReminder,
} from '@/lib/repositories/reminders.repo'

// ── Mock Supabase client builder ─────────────────────────────────────────────

interface MockChain {
  select:      ReturnType<typeof vi.fn>
  insert:      ReturnType<typeof vi.fn>
  update:      ReturnType<typeof vi.fn>
  delete:      ReturnType<typeof vi.fn>
  upsert:      ReturnType<typeof vi.fn>
  eq:          ReturnType<typeof vi.fn>
  lte:         ReturnType<typeof vi.fn>
  limit:       ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
}

function createMockChain(resolvedValue: { data?: unknown; error?: { message: string } | null }): MockChain {
  const terminal = vi.fn().mockResolvedValue(resolvedValue)

  const chain: MockChain = {
    select:      vi.fn(),
    insert:      vi.fn(),
    update:      vi.fn(),
    delete:      vi.fn(),
    upsert:      vi.fn(),
    eq:          vi.fn(),
    lte:         vi.fn(),
    limit:       terminal,
    maybeSingle: terminal,
  }

  // Every chainable method returns the chain itself
  chain.select.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.delete.mockReturnValue(chain)
  chain.upsert.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.lte.mockReturnValue(chain)

  return chain
}

function createMockSupabase(chain: MockChain) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: vi.fn().mockReturnValue(chain) } as any
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('upsertReminder', () => {
  it('deletes existing pending reminder then inserts new one', async () => {
    const deleteChain = createMockChain({ data: null, error: null })
    const insertChain = createMockChain({ data: null, error: null })

    // insert resolves directly (no terminal needed)
    insertChain.insert.mockResolvedValue({ data: null, error: null })

    let callCount = 0
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        callCount++
        return callCount === 1 ? deleteChain : insertChain
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await upsertReminder(supabase, 'apt-1', 'biz-1', '2026-03-25T08:00:00Z', 60)

    expect(supabase.from).toHaveBeenCalledWith('appointment_reminders')
    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith('appointment_id', 'apt-1')
    expect(deleteChain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('throws when insert fails', async () => {
    const deleteChain = createMockChain({ data: null, error: null })
    const insertChain = createMockChain({ data: null, error: null })
    insertChain.insert.mockResolvedValue({ data: null, error: { message: 'DB insert failed' } })

    let callCount = 0
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        callCount++
        return callCount === 1 ? deleteChain : insertChain
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(upsertReminder(supabase, 'apt-1', 'biz-1', '2026-03-25T08:00:00Z', 60))
      .rejects.toThrow('Error creating reminder: DB insert failed')
  })
})

describe('cancelRemindersByAppointment', () => {
  it('updates pending reminders to cancelled status', async () => {
    const chain = createMockChain({ data: null, error: null })
    // update needs to resolve with { error: null } at the end of the chain
    chain.eq.mockReturnValue(chain)
    // Make the last eq call resolve
    const terminalEq = vi.fn().mockResolvedValue({ data: null, error: null })
    let eqCount = 0
    chain.eq.mockImplementation((..._args: unknown[]) => {
      eqCount++
      if (eqCount === 2) return terminalEq()
      return chain
    })

    const supabase = createMockSupabase(chain)

    await cancelRemindersByAppointment(supabase, 'apt-1')

    expect(supabase.from).toHaveBeenCalledWith('appointment_reminders')
    expect(chain.update).toHaveBeenCalledWith({ status: 'cancelled' })
  })

  it('throws when update fails', async () => {
    const chain = createMockChain({ data: null, error: null })
    let eqCount = 0
    chain.eq.mockImplementation(() => {
      eqCount++
      if (eqCount === 2) return Promise.resolve({ data: null, error: { message: 'Update failed' } })
      return chain
    })

    const supabase = createMockSupabase(chain)

    await expect(cancelRemindersByAppointment(supabase, 'apt-1'))
      .rejects.toThrow('Error cancelling reminders: Update failed')
  })
})

describe('getPendingReminders', () => {
  it('returns pending reminders with joined data', async () => {
    const mockReminders = [
      {
        id: 'r1',
        appointment_id: 'apt-1',
        business_id: 'biz-1',
        remind_at: '2026-03-25T08:00:00Z',
        minutes_before: 60,
        businesses: { name: 'Salón Cronix', settings: null },
        appointments: {
          start_at: '2026-03-25T09:00:00Z',
          clients: { name: 'María', phone: '+573001234567' },
        },
      },
    ]

    const chain = createMockChain({ data: mockReminders, error: null })
    const supabase = createMockSupabase(chain)

    const result = await getPendingReminders(supabase)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('r1')
    expect(result[0].appointments?.clients.name).toBe('María')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('returns empty array when no data', async () => {
    const chain = createMockChain({ data: null, error: null })
    const supabase = createMockSupabase(chain)

    const result = await getPendingReminders(supabase)

    expect(result).toEqual([])
  })

  it('throws when query fails', async () => {
    const chain = createMockChain({ data: null, error: { message: 'Query error' } })
    const supabase = createMockSupabase(chain)

    await expect(getPendingReminders(supabase)).rejects.toThrow('Error fetching pending reminders: Query error')
  })
})

describe('markReminderSent', () => {
  it('updates status to sent with timestamp', async () => {
    const chain = createMockChain({ data: null, error: null })
    chain.eq.mockResolvedValue({ data: null, error: null })
    const supabase = createMockSupabase(chain)

    await markReminderSent(supabase, 'r1')

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', sent_at: expect.any(String) }),
    )
    expect(supabase.from).toHaveBeenCalledWith('appointment_reminders')
  })

  it('throws when update fails', async () => {
    const chain = createMockChain({ data: null, error: null })
    chain.eq.mockResolvedValue({ data: null, error: { message: 'Mark sent failed' } })
    const supabase = createMockSupabase(chain)

    await expect(markReminderSent(supabase, 'r1'))
      .rejects.toThrow('Error marking reminder sent: Mark sent failed')
  })
})

describe('markReminderFailed', () => {
  it('updates status to failed with error message', async () => {
    const chain = createMockChain({ data: null, error: null })
    chain.eq.mockResolvedValue({ data: null, error: null })
    const supabase = createMockSupabase(chain)

    await markReminderFailed(supabase, 'r1', 'Phone unreachable')

    expect(chain.update).toHaveBeenCalledWith({
      status: 'failed',
      error_message: 'Phone unreachable',
    })
  })

  it('throws when update fails', async () => {
    const chain = createMockChain({ data: null, error: null })
    chain.eq.mockResolvedValue({ data: null, error: { message: 'Mark failed error' } })
    const supabase = createMockSupabase(chain)

    await expect(markReminderFailed(supabase, 'r1', 'Phone unreachable'))
      .rejects.toThrow('Error marking reminder failed: Mark failed error')
  })
})

describe('getAppointmentReminder', () => {
  it('returns minutes_before for existing pending reminder', async () => {
    const chain = createMockChain({ data: { minutes_before: 60 }, error: null })
    const supabase = createMockSupabase(chain)

    const result = await getAppointmentReminder(supabase, 'apt-1')

    expect(result).toEqual({ minutes_before: 60 })
    expect(chain.select).toHaveBeenCalledWith('minutes_before')
    expect(chain.eq).toHaveBeenCalledWith('appointment_id', 'apt-1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('returns null when no pending reminder exists', async () => {
    const chain = createMockChain({ data: null, error: null })
    const supabase = createMockSupabase(chain)

    const result = await getAppointmentReminder(supabase, 'apt-1')

    expect(result).toBeNull()
  })
})
