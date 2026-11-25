/**
 * phone-agent-api — WhatsApp calls (contract §4.1, §4.1b): the business comes from the same
 * routing as WhatsApp messages without #slug (session, then client phone), the caller names it
 * when that routing cannot decide, and no endpoint reads a call that has no business yet.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMockSupabase, type CapturedOp, type MockResponse } from '../../_shared/__tests__/_mock-supabase.ts'
import { hmacSha256Hex } from '../../_shared/hmac.ts'
import { handle } from '../index.ts'
import { businessesNamed } from '../business-choice.ts'

vi.mock('../../_shared/sentry.ts', () => ({ initSentry: () => {}, captureException: () => {} }))
vi.mock('../../_shared/supabase.ts', () => ({ getAdminClient: () => ({}) }))
vi.mock('../../_shared/notifications/emit-booking-event.ts', () => ({ emitBookingEvent: async () => {} }))

const SECRET = 'test-signing-secret'
const BASE = 'http://localhost/functions/v1/phone-agent-api'
const BIZ_A = 'a0000000-0000-0000-0000-00000000000a'
const BIZ_B = 'b0000000-0000-0000-0000-00000000000b'
const HOURS = { mon: ['09:00', '11:00'], sun: null }
const CALLER = '+584121234567' // what the agent sends: E.164
const SENDER_ID = '584121234567' // what wa_sessions keeps: Meta's sender id

async function signed(method: string, route: string, body: unknown = null): Promise<Request> {
  const raw = body === null ? '' : JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await hmacSha256Hex(SECRET, `${timestamp}.${method}.${route}.${raw}`)
  return new Request(`${BASE}${route}`, {
    method, headers: { 'x-cronix-timestamp': timestamp, 'x-cronix-signature': signature }, body: raw || undefined,
  })
}

const BUSINESSES: Record<string, { name: string; timezone: string; settings: Record<string, unknown> }> = {
  [BIZ_A]: { name: 'Barbería de Ana', timezone: 'America/Caracas', settings: { workingHours: HOURS, currency: 'VES' } },
  [BIZ_B]: { name: 'Clínica Dental Sol', timezone: 'America/Bogota', settings: {} },
}

const eqValue = (op: CapturedOp, column: string) => op.eq.find(([c]) => c === column)?.[1]

/** A database with no session, no client and two businesses, unless a test overrides a read. */
function backend(overrides: (op: CapturedOp) => MockResponse | undefined = () => undefined) {
  return createMockSupabase((op) => {
    const custom = overrides(op)
    if (custom) return custom
    if (op.table === 'wa_sessions') return { data: null }
    if (op.table === 'clients') return { data: op.selectArg === 'name' ? null : [] }
    if (op.table === 'businesses' && op.selectArg === 'id, name') {
      return { data: Object.entries(BUSINESSES).map(([id, b]) => ({ id, name: b.name })) }
    }
    if (op.table === 'businesses') return { data: BUSINESSES[String(eqValue(op, 'id'))] ?? null }
    if (op.table === 'services' && op.selectArg === 'duration_min') return { data: { duration_min: 60 } }
    if (op.table === 'services') return { data: [{ id: `svc-${String(eqValue(op, 'business_id'))}`, name: 'Corte', duration_min: 30, price: 10 }] }
    if (op.table === 'phone_agent_calls' && op.type === 'update') return { data: [{ call_sid: 'WA1' }] }
    if (op.table === 'phone_agent_calls' && op.type === 'select') return { data: { business_id: null, channel: 'whatsapp' } }
    if (op.table === 'appointments') return { data: [] }
    return { data: null }
  })
}

const startWhatsApp = (from: string | null = CALLER) =>
  signed('POST', '/v1/calls/start', { call_sid: 'WA1', channel: 'whatsapp', to: '+584240000000', from })

async function json(res: Response) {
  return await res.json() as Record<string, unknown>
}

describe('calls/start on WhatsApp', () => {
  it('resolves the business from the caller WhatsApp session, keyed by the Meta sender id', async () => {
    const m = backend((op) => (op.table === 'wa_sessions' ? { data: { business_id: BIZ_A } } : undefined))
    const body = await json(await handle(await startWhatsApp(), SECRET, m.supabase))
    expect(body.success).toBe(true)
    expect(body.business).toEqual({ id: BIZ_A, name: 'Barbería de Ana', timezone: 'America/Caracas', currency: 'VES' })
    expect(body.working_hours).toEqual(HOURS)
    expect(body.services).toEqual([{ id: `svc-${BIZ_A}`, name: 'Corte', name_en: null, duration_min: 30, price: 10 }])
    expect(m.opsFor('wa_sessions')[0]?.eq).toEqual([['sender_phone', SENDER_ID]])
    expect(m.opsFor('phone_agent_lines')).toHaveLength(0) // the dialed number decides nothing on WhatsApp
  })

  it('resolves the business by the client phone when there is no session', async () => {
    const m = backend((op) => (op.table === 'clients' && op.selectArg === 'id, business_id'
      ? { data: [{ id: 'c1', business_id: BIZ_B }] }
      : undefined))
    const body = await json(await handle(await startWhatsApp(), SECRET, m.supabase))
    expect((body.business as { id: string }).id).toBe(BIZ_B)
    const routing = m.opsFor('clients').find((op) => op.selectArg === 'id, business_id')!
    expect(routing.in).toContainEqual(['phone_digits', [SENDER_ID, '5804121234567']])
    expect(routing.is).toContainEqual(['deleted_at', null])
  })

  it('records the call without a business and asks for the choice when no routing decides', async () => {
    const m = backend()
    const body = await json(await handle(await startWhatsApp(), SECRET, m.supabase))
    expect(body).toEqual({ success: true, business: null, needs_business_choice: true })
    const record = m.opsFor('phone_agent_calls')[0]!
    expect(record.insertPayload).toEqual({
      call_sid: 'WA1', business_id: null, channel: 'whatsapp', caller_phone: CALLER, identity_verified: true,
    })
    expect(record.upsertOpts).toEqual({ onConflict: 'call_sid', ignoreDuplicates: true })
    expect(m.opsFor('services')).toHaveLength(0)
  })

  it('stores the identity as verified and names the known client by first name only', async () => {
    const m = backend((op) => {
      if (op.table === 'wa_sessions') return { data: { business_id: BIZ_A } }
      if (op.table === 'clients' && op.selectArg === 'name') return { data: { name: '  Ana María Pérez ' } }
      return undefined
    })
    const body = await json(await handle(await startWhatsApp(), SECRET, m.supabase))
    expect(body.known_client).toBe('Ana')
    const known = m.opsFor('clients').find((op) => op.selectArg === 'name')!
    expect(known.eq).toContainEqual(['business_id', BIZ_A])
    expect(known.in).toContainEqual(['phone_digits', [SENDER_ID, '5804121234567']])
    expect(known.is).toContainEqual(['deleted_at', null])
    expect(m.opsFor('phone_agent_calls')[0]?.insertPayload).toMatchObject({ business_id: BIZ_A, identity_verified: true })
  })

  it('answers known_client null when the business has no client with that phone', async () => {
    const m = backend((op) => (op.table === 'wa_sessions' ? { data: { business_id: BIZ_A } } : undefined))
    const body = await json(await handle(await startWhatsApp(), SECRET, m.supabase))
    expect(body.known_client).toBeNull()
  })

  it('refuses a WhatsApp call without the caller number', async () => {
    const m = backend()
    const body = await json(await handle(await startWhatsApp(null), SECRET, m.supabase))
    expect(body).toEqual({ success: false, error: 'INVALID_ARGS' })
    expect(m.ops).toHaveLength(0)
  })
})

describe('calls/start on the phone line stays as it was', () => {
  it('never verifies the identity, never names the caller and never routes by WhatsApp', async () => {
    const m = backend((op) => (op.table === 'phone_agent_lines' ? { data: { business_id: BIZ_A } } : undefined))
    const res = await handle(await signed('POST', '/v1/calls/start', {
      call_sid: 'CA1', channel: 'twilio', to: '+13055550100', from: CALLER,
    }), SECRET, m.supabase)
    const body = await json(res)
    expect(body.known_client).toBeNull()
    expect((body.business as { id: string }).id).toBe(BIZ_A)
    expect(m.opsFor('phone_agent_calls')[0]?.insertPayload).toEqual({
      call_sid: 'CA1', business_id: BIZ_A, channel: 'twilio', caller_phone: CALLER, identity_verified: false,
    })
    expect(m.opsFor('wa_sessions')).toHaveLength(0)
    expect(m.opsFor('clients')).toHaveLength(0)
  })
})

describe('calls/{call_sid}/business', () => {
  const choose = (body: unknown, sid = 'WA1') => signed('POST', `/v1/calls/${sid}/business`, body)

  it('sets the business the caller named, once, and returns the same context as the start', async () => {
    const m = backend()
    const body = await json(await handle(await choose({ spoken_name: 'barberia de ana' }), SECRET, m.supabase))
    expect(body.success).toBe(true)
    expect(body.business).toEqual({ id: BIZ_A, name: 'Barbería de Ana', timezone: 'America/Caracas', currency: 'VES' })
    expect(body.working_hours).toEqual(HOURS)
    expect(body.known_client).toBeNull()
    const update = m.opsFor('phone_agent_calls').find((op) => op.type === 'update')!
    expect(update.updatePayload).toEqual({ business_id: BIZ_A })
    expect(update.eq).toEqual([['call_sid', 'WA1'], ['channel', 'whatsapp']])
    expect(update.is).toEqual([['business_id', null]]) // set only while it has none
  })

  it('matches across case, accents, punctuation and a name said in part', async () => {
    for (const spoken of ['BARBERÍA DE ANA!', 'la barbería de ana, por favor', 'dental sol']) {
      const m = backend()
      const body = await json(await handle(await choose({ spoken_name: spoken }), SECRET, m.supabase))
      expect(body.success, spoken).toBe(true)
    }
  })

  it('never takes the business from the request body', async () => {
    const m = backend()
    await handle(await choose({ spoken_name: 'barbería de ana', business_id: BIZ_B }), SECRET, m.supabase)
    expect(m.opsFor('phone_agent_calls').find((op) => op.type === 'update')?.updatePayload).toEqual({ business_id: BIZ_A })
    expect(m.opsFor('services').every((op) => eqValue(op, 'business_id') === BIZ_A)).toBe(true)
  })

  it('answers AMBIGUOUS with at most three candidate names and sets nothing', async () => {
    const names = ['Barbería Ana Centro', 'Barbería Ana Norte', 'Barbería Ana Sur', 'Barbería Ana Este']
    const m = backend((op) => (op.table === 'businesses' && op.selectArg === 'id, name'
      ? { data: names.map((name, i) => ({ id: `biz-${i}`, name })) }
      : undefined))
    const body = await json(await handle(await choose({ spoken_name: 'barbería ana' }), SECRET, m.supabase))
    expect(body).toEqual({ success: false, error: 'AMBIGUOUS', candidates: names.slice(0, 3) })
    expect(m.opsFor('phone_agent_calls').filter((op) => op.type === 'update')).toHaveLength(0)
  })

  it('prefers the one business whose name is exactly the one said', async () => {
    const m = backend((op) => (op.table === 'businesses' && op.selectArg === 'id, name'
      ? { data: [{ id: BIZ_A, name: 'Ana' }, { id: BIZ_B, name: 'Uñas de Ana' }] }
      : undefined))
    await handle(await choose({ spoken_name: 'ana' }), SECRET, m.supabase)
    expect(m.opsFor('phone_agent_calls').find((op) => op.type === 'update')?.updatePayload).toEqual({ business_id: BIZ_A })
  })

  it('answers NO_MATCH when no business has that name, including a word that is only inside another', async () => {
    for (const spoken of ['peluquería luna', 'an']) {
      const m = backend()
      const body = await json(await handle(await choose({ spoken_name: spoken }), SECRET, m.supabase))
      expect(body, spoken).toEqual({ success: false, error: 'NO_MATCH' })
      expect(m.opsFor('phone_agent_calls').filter((op) => op.type === 'update')).toHaveLength(0)
    }
  })

  it('answers ALREADY_SET for a call that already has its business', async () => {
    const m = backend((op) => (op.table === 'phone_agent_calls' && op.type === 'select'
      ? { data: { business_id: BIZ_B, channel: 'whatsapp' } }
      : undefined))
    const body = await json(await handle(await choose({ spoken_name: 'barbería de ana' }), SECRET, m.supabase))
    expect(body).toEqual({ success: false, error: 'ALREADY_SET' })
    expect(m.opsFor('phone_agent_calls').filter((op) => op.type === 'update')).toHaveLength(0)
  })

  it('answers ALREADY_SET when another request set the business first', async () => {
    const m = backend((op) => (op.table === 'phone_agent_calls' && op.type === 'update' ? { data: [] } : undefined))
    const body = await json(await handle(await choose({ spoken_name: 'barbería de ana' }), SECRET, m.supabase))
    expect(body).toEqual({ success: false, error: 'ALREADY_SET' })
    expect(m.opsFor('services')).toHaveLength(0)
  })

  it('refuses a phone line call: its business comes only from the dialed number', async () => {
    const m = backend((op) => (op.table === 'phone_agent_calls' && op.type === 'select'
      ? { data: { business_id: BIZ_A, channel: 'twilio' } }
      : undefined))
    const body = await json(await handle(await choose({ spoken_name: 'clínica dental sol' }, 'CA1'), SECRET, m.supabase))
    expect(body).toEqual({ success: false, error: 'ALREADY_SET' })
    expect(m.opsFor('phone_agent_calls').filter((op) => op.type === 'update')).toHaveLength(0)
  })

  it('answers NOT_FOUND for a call never started and INVALID_ARGS without a name', async () => {
    const unknown = backend((op) => (op.table === 'phone_agent_calls' ? { data: null } : undefined))
    expect(await json(await handle(await choose({ spoken_name: 'ana' }), SECRET, unknown.supabase)))
      .toEqual({ success: false, error: 'NOT_FOUND' })
    for (const body of [{}, { spoken_name: '  ¿? ' }, { spoken_name: 'a'.repeat(121) }]) {
      const m = backend()
      expect(await json(await handle(await choose(body), SECRET, m.supabase))).toEqual({ success: false, error: 'INVALID_ARGS' })
      expect(m.ops).toHaveLength(0)
    }
  })
})

describe('a call without a business', () => {
  it('is refused by availability before reading any business data', async () => {
    const m = backend()
    const res = await handle(await signed('GET', '/v1/availability?call_sid=WA1&service_id=s1&date=2030-06-17'), SECRET, m.supabase)
    expect(await json(res)).toEqual({ success: false, error: 'BUSINESS_NOT_SET' })
    expect(m.opsFor('services')).toHaveLength(0)
    expect(m.opsFor('appointments')).toHaveLength(0)
  })

  it('can still be closed when the caller hangs up before naming the business', async () => {
    const m = backend()
    const res = await handle(await signed('POST', '/v1/calls/WA1/end', { outcome: 'abandoned' }), SECRET, m.supabase)
    expect(await json(res)).toEqual({ success: true })
  })
})

describe('tenant isolation', () => {
  it('a WhatsApp call of business A reads only A: its context and its availability', async () => {
    const m = backend((op) => {
      if (op.table === 'wa_sessions') return { data: { business_id: BIZ_A } }
      if (op.table === 'phone_agent_calls' && op.type === 'select') return { data: { business_id: BIZ_A } }
      return undefined
    })
    await handle(await startWhatsApp(), SECRET, m.supabase)
    await handle(await signed('GET', '/v1/availability?call_sid=WA1&service_id=s1&date=2030-06-17'), SECRET, m.supabase)
    const scoped = m.ops.filter((op) => ['services', 'appointments'].includes(op.table) || (op.table === 'clients' && op.selectArg === 'name'))
    expect(scoped.length).toBeGreaterThanOrEqual(4)
    for (const op of scoped) expect(eqValue(op, 'business_id'), op.table).toBe(BIZ_A)
    const businessReads = m.opsFor('businesses').map((op) => eqValue(op, 'id'))
    expect(businessReads).toEqual([BIZ_A, BIZ_A])
  })
})

describe('matching a spoken business name', () => {
  const businesses = [
    { id: 'b1', name: 'Barbería Ana' },
    { id: 'b2', name: 'Clínica Dental Centro' },
    { id: 'b3', name: 'María' },
  ]
  const named = (spoken: string) => businessesNamed(spoken, businesses).map((b) => b.id)

  it('ignores the articles and "de" a caller adds when saying the name', () => {
    expect(named('barbería de ana')).toEqual(['b1'])
    expect(named('la barbería de ana')).toEqual(['b1'])
    expect(named('la clínica dental del centro')).toEqual(['b2'])
  })

  it('does not choose a one-word business only because that word was said inside a longer name', () => {
    expect(named('la peluquería de maría')).toEqual([])
  })

  it('still matches a one-word business said on its own, and a part of a longer name', () => {
    expect(named('maría')).toEqual(['b3'])
    expect(named('ana')).toEqual(['b1'])
  })
})
