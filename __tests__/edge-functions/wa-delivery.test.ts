// @vitest-environment node
/**
 * A reminder was marked 'sent' as soon as Meta accepted it, and the webhook dropped the
 * status events Meta sends afterwards, so a message that never reached the phone was
 * invisible (measured on production, 2026-11-06). These are the shapes Meta sends.
 */
import { describe, expect, it } from 'vitest'
import {
  acceptedMessageId, metaSendError, parseStatusEvents, parseTrack, recordAcceptedMessage, recordStatuses,
} from '../../supabase/functions/_shared/wa-delivery'

const statusPayload = (statuses: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: {}, statuses } }] }],
})

describe('parseStatusEvents', () => {
  it('reads a delivered event', () => {
    const out = parseStatusEvents(statusPayload([{ id: 'wamid.A', status: 'delivered', timestamp: '1762390800', recipient_id: '584140000001' }]))
    expect(out).toEqual([{ wamid: 'wamid.A', status: 'delivered', at: '2025-11-06T01:00:00.000Z', errorCode: null, errorTitle: null }])
  })

  it('keeps the code and title of a failure', () => {
    const out = parseStatusEvents(statusPayload([{
      id: 'wamid.B', status: 'failed', timestamp: '1762390800',
      errors: [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.' }],
    }]))
    expect(out[0]).toMatchObject({ wamid: 'wamid.B', status: 'failed', errorCode: 131049 })
    expect(out[0]!.errorTitle).toMatch(/healthy ecosystem/)
  })

  it('reads every status of every entry and change', () => {
    const payload = {
      entry: [
        { changes: [{ value: { statuses: [{ id: 'w1', status: 'sent', timestamp: '1' }, { id: 'w2', status: 'read', timestamp: '2' }] } }] },
        { changes: [{ value: { statuses: [{ id: 'w3', status: 'failed', timestamp: '3', errors: [{ code: 131026, message: 'Message undeliverable' }] }] } }] },
      ],
    }
    expect(parseStatusEvents(payload).map((u) => [u.wamid, u.status, u.errorCode, u.errorTitle])).toEqual([
      ['w1', 'sent', null, null], ['w2', 'read', null, null], ['w3', 'failed', 131026, 'Message undeliverable'],
    ])
  })

  it('ignores messages, unknown statuses and broken shapes', () => {
    expect(parseStatusEvents({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.M', type: 'text' }] } }] }] })).toEqual([])
    expect(parseStatusEvents(statusPayload([{ id: 'w', status: 'deleted' }, { status: 'sent' }, null, 'x']))).toEqual([])
    expect(parseStatusEvents(null)).toEqual([])
    expect(parseStatusEvents({ entry: 'nope' })).toEqual([])
  })
})

describe('what whatsapp-service reads from Meta', () => {
  it('takes the message id of an accepted send', () => {
    expect(acceptedMessageId({ messaging_product: 'whatsapp', contacts: [{ wa_id: '58414' }], messages: [{ id: 'wamid.HBg' }] })).toBe('wamid.HBg')
    expect(acceptedMessageId({ messages: [] })).toBeNull()
    expect(acceptedMessageId(null)).toBeNull()
  })

  it('takes the code and text of a rejected send', () => {
    expect(metaSendError({ error: { message: '(#132001) Template name does not exist in the translation', code: 132001 } }))
      .toEqual({ code: 132001, message: '(#132001) Template name does not exist in the translation' })
    expect(metaSendError({})).toEqual({ code: null, message: null })
  })

  it('accepts only a well formed track', () => {
    expect(parseTrack({ businessId: 'b1', purpose: 'client_reminder', appointmentId: 'a1' })).toEqual({ businessId: 'b1', purpose: 'client_reminder', appointmentId: 'a1' })
    expect(parseTrack({ businessId: 'b1', purpose: 'owner_alert' })).toEqual({ businessId: 'b1', purpose: 'owner_alert', appointmentId: null })
    expect(parseTrack({ businessId: 'b1', purpose: 'marketing' })).toBeNull()
    expect(parseTrack({ purpose: 'client_reminder' })).toBeNull()
    expect(parseTrack(undefined)).toBeNull()
  })
})

describe('writes', () => {
  it('records each status through the forward-only function and counts failures', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { error: args.p_wamid === 'bad' ? { message: 'boom' } : null } },
      from: () => ({ upsert: async () => ({ error: null }) }),
    }
    const res = await recordStatuses(db, [
      { wamid: 'ok', status: 'delivered', at: '2026-11-06T00:00:00.000Z', errorCode: null, errorTitle: null },
      { wamid: 'bad', status: 'failed', at: '2026-11-06T00:00:00.000Z', errorCode: 131049, errorTitle: 't' },
    ])
    expect(res).toEqual({ failed: 1, lastError: 'boom' })
    expect(calls[0]).toEqual(['fn_record_wa_status', { p_wamid: 'ok', p_status: 'delivered', p_error_code: null, p_error_title: null, p_at: '2026-11-06T00:00:00.000Z' }])
  })

  it('stores who an accepted message belongs to without touching its status', async () => {
    let written: Record<string, unknown> = {}
    let conflict = ''
    const db = {
      rpc: async () => ({ error: null }),
      from: (table: string) => ({ upsert: async (values: Record<string, unknown>, o: { onConflict: string }) => { written = { table, ...values }; conflict = o.onConflict; return { error: null } } }),
    }
    await recordAcceptedMessage(db, { wamid: 'w', track: { businessId: 'b', purpose: 'client_reminder', appointmentId: 'a' }, template: 'appointment_reminder', at: 't' })
    expect(written).toEqual({ table: 'wa_message_status', wamid: 'w', business_id: 'b', purpose: 'client_reminder', appointment_id: 'a', template: 'appointment_reminder', accepted_at: 't' })
    expect(written).not.toHaveProperty('status')
    expect(conflict).toBe('wamid')
  })
})
