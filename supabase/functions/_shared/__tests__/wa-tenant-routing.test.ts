/**
 * wa-tenant-routing.test.ts — the WhatsApp tiers without #slug that messages and calls share:
 * the sender's session, then the business that has the sender as a client.
 */
import { describe, expect, it } from 'vitest'
import { createMockSupabase } from './_mock-supabase.ts'
import { clientPhoneBusinessId, sessionBusinessId } from '../wa-tenant-routing.ts'

describe('sessionBusinessId', () => {
  it('returns the business anchored to that sender id, or null without a session', async () => {
    const m = createMockSupabase(() => ({ data: { business_id: 'biz-1' } }))
    expect(await sessionBusinessId(m.supabase, '584121234567')).toBe('biz-1')
    expect(m.ops[0]).toMatchObject({ table: 'wa_sessions', selectArg: 'business_id', eq: [['sender_phone', '584121234567']] })
    expect(await sessionBusinessId(createMockSupabase(() => ({ data: null })).supabase, '584121234567')).toBeNull()
  })

  it('throws on a database failure instead of answering "no session"', async () => {
    const m = createMockSupabase(() => ({ error: { message: 'down' } }))
    await expect(sessionBusinessId(m.supabase, '584121234567')).rejects.toThrow('down')
  })
})

describe('clientPhoneBusinessId', () => {
  it('finds the one business that has the sender as a client, the trunk-zero form included', async () => {
    const m = createMockSupabase(() => ({ data: [{ id: 'c1', business_id: 'biz-1' }] }))
    expect(await clientPhoneBusinessId(m.supabase, '+58 412 123 4567')).toBe('biz-1')
    const read = m.opsFor('clients')[0]!
    expect(read.in).toEqual([['phone_digits', ['584121234567', '5804121234567']]])
    expect(read.is).toEqual([['deleted_at', null]])
    expect(m.opsFor('appointments')).toHaveLength(0) // no tie, no appointment read
  })

  it('breaks a tie between businesses by the soonest upcoming appointment, and gives up without one', async () => {
    const clients = [{ id: 'c1', business_id: 'biz-1' }, { id: 'c2', business_id: 'biz-2' }]
    const tie = createMockSupabase((op) => (op.table === 'clients'
      ? { data: clients }
      : { data: [{ business_id: 'biz-2', start_at: '2030-01-01T10:00:00Z' }] }))
    expect(await clientPhoneBusinessId(tie.supabase, '584121234567')).toBe('biz-2')
    expect(tie.opsFor('appointments')[0]?.in).toContainEqual(['client_id', ['c1', 'c2']])

    const none = createMockSupabase((op) => (op.table === 'clients' ? { data: clients } : { data: [] }))
    expect(await clientPhoneBusinessId(none.supabase, '584121234567')).toBeNull()
  })

  it('returns null for a sender without digits and throws when the clients read fails', async () => {
    const m = createMockSupabase(() => ({ data: [] }))
    expect(await clientPhoneBusinessId(m.supabase, 'anonymous')).toBeNull()
    expect(m.ops).toHaveLength(0)
    const down = createMockSupabase(() => ({ error: { message: 'down' } }))
    await expect(clientPhoneBusinessId(down.supabase, '584121234567')).rejects.toThrow('down')
  })
})
