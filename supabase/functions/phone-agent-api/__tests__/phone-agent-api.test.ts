/**
 * phone-agent-api — signature, routes and isolation, against the shared Supabase mock.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMockSupabase, type CapturedOp, type MockResponse } from '../../_shared/__tests__/_mock-supabase.ts'
import { hmacSha256Hex } from '../../_shared/hmac.ts'
import { handle } from '../index.ts'
import { isSignedByTheAgent, MAX_CLOCK_SKEW_S } from '../signature.ts'

// Sentry's Deno SDK is not loadable in vitest; the other function tests stub it the same way.
vi.mock('../../_shared/sentry.ts', () => ({ initSentry: () => {}, captureException: () => {} }))
vi.mock('../../_shared/supabase.ts', () => ({ getAdminClient: () => ({}) }))
vi.mock('../../_shared/notifications/emit-booking-event.ts', () => ({ emitBookingEvent: async () => {} }))

const SECRET = 'test-signing-secret'
const BIZ = 'b0000000-0000-0000-0000-000000000001'
const BASE = 'http://localhost/functions/v1/phone-agent-api'

async function signed(method: string, route: string, body: unknown = null, secret = SECRET): Promise<Request> {
  const raw = body === null ? '' : JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await hmacSha256Hex(secret, `${timestamp}.${method}.${route}.${raw}`)
  return new Request(`${BASE}${route}`, {
    method,
    headers: { 'x-cronix-timestamp': timestamp, 'x-cronix-signature': signature },
    body: raw || undefined,
  })
}

const OPEN_MONDAYS = { mon: ['09:00', '11:00'], sun: null }

function backend(overrides: (op: CapturedOp) => MockResponse | undefined = () => undefined) {
  return createMockSupabase((op) => {
    const custom = overrides(op)
    if (custom) return custom
    if (op.table === 'phone_agent_lines') return { data: { business_id: BIZ } }
    if (op.table === 'phone_agent_calls' && op.type === 'select') return { data: { business_id: BIZ } }
    if (op.table === 'phone_agent_calls') return { data: [{ call_sid: 'CA1' }] }
    if (op.table === 'businesses') return { data: { name: 'Barbería Prueba', timezone: 'America/Caracas', settings: { workingHours: OPEN_MONDAYS } } }
    if (op.table === 'services' && op.selectArg === 'duration_min') return { data: { duration_min: 60 } }
    if (op.table === 'services') return { data: [{ id: 's1', name: 'Corte', duration_min: 30, price: 10 }] }
    if (op.table === 'appointments') return { data: [] }
    return { data: null }
  })
}

describe('signature', () => {
  it('accepts the agent signature and refuses a wrong secret, a stale time or missing headers', async () => {
    const now = Date.now()
    const timestamp = String(Math.floor(now / 1000))
    const signature = await hmacSha256Hex(SECRET, `${timestamp}.POST./v1/calls/start.{}`)
    const request = { method: 'POST', route: '/v1/calls/start', body: '{}', timestamp, signature }
    expect(await isSignedByTheAgent(request, SECRET, now)).toBe(true)
    expect(await isSignedByTheAgent(request, 'another-secret', now)).toBe(false)
    expect(await isSignedByTheAgent(request, SECRET, now + (MAX_CLOCK_SKEW_S + 1) * 1000)).toBe(false)
    expect(await isSignedByTheAgent({ ...request, body: '{"x":1}' }, SECRET, now)).toBe(false)
    expect(await isSignedByTheAgent({ ...request, signature: null }, SECRET, now)).toBe(false)
    expect(await isSignedByTheAgent(request, '', now)).toBe(false) // no secret configured
  })

  it('answers 401 with no body and touches no table when the signature is wrong', async () => {
    const m = backend()
    const res = await handle(await signed('POST', '/v1/calls/start', { call_sid: 'CA1' }, 'wrong'), SECRET, m.supabase)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(m.ops).toHaveLength(0)
  })
})

describe('calls/start', () => {
  it('answers UNKNOWN_LINE for a number no business owns', async () => {
    const m = backend((op) => (op.table === 'phone_agent_lines' ? { data: null } : undefined))
    const res = await handle(await signed('POST', '/v1/calls/start', { call_sid: 'CA1', channel: 'twilio', to: '+1 305 555 0100', from: '+584121234567' }), SECRET, m.supabase)
    expect(await res.json()).toEqual({ success: false, error: 'UNKNOWN_LINE' })
    expect(m.opsFor('phone_agent_lines')[0]?.eq).toContainEqual(['phone_digits', '13055550100'])
  })

  it('returns the business, its active services, the hours that apply and keeps the call record once', async () => {
    const m = backend()
    const res = await handle(await signed('POST', '/v1/calls/start', { call_sid: 'CA1', channel: 'twilio', to: '+13055550100', from: '+584121234567' }), SECRET, m.supabase)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.business).toEqual({ id: BIZ, name: 'Barbería Prueba', timezone: 'America/Caracas', currency: 'USD' })
    expect(body.working_hours).toEqual(OPEN_MONDAYS)
    expect(body.known_client).toBeNull() // the phone line never names the caller
    const record = m.opsFor('phone_agent_calls')[0]!
    expect(record.insertPayload).toMatchObject({ call_sid: 'CA1', business_id: BIZ, channel: 'twilio' })
    expect(record.upsertOpts).toEqual({ onConflict: 'call_sid', ignoreDuplicates: true })
    expect(m.opsFor('services')[0]?.eq).toContainEqual(['is_active', true])
  })

  it('refuses another channel than the phone line', async () => {
    const m = backend()
    const res = await handle(await signed('POST', '/v1/calls/start', { call_sid: 'CA1', channel: 'whatsapp', to: '+13055550100' }), SECRET, m.supabase)
    expect(await res.json()).toEqual({ success: false, error: 'INVALID_ARGS' })
  })
})

describe('availability', () => {
  const route = (date: string) => `/v1/availability?call_sid=CA1&service_id=s1&date=${date}`

  it('computes the free starts with the shared resolver, the service read within the call business', async () => {
    const m = backend()
    const res = await handle(await signed('GET', route('2030-06-17')), SECRET, m.supabase)
    expect(await res.json()).toEqual({ success: true, date: '2030-06-17', slots: ['09:00', '09:30', '10:00'] })
    expect(m.opsFor('services')[0]?.eq).toContainEqual(['business_id', BIZ])
    expect(m.opsFor('appointments')[0]?.in).toContainEqual(['status', ['pending', 'confirmed', 'completed']])
  })

  it('answers CLOSED_DAY, and NOT_FOUND for a call that was never started', async () => {
    const closed = await handle(await signed('GET', route('2030-06-16')), SECRET, backend().supabase)
    expect(await closed.json()).toEqual({ success: false, error: 'CLOSED_DAY' })
    const unknown = backend((op) => (op.table === 'phone_agent_calls' ? { data: null } : undefined))
    const res = await handle(await signed('GET', route('2030-06-17')), SECRET, unknown.supabase)
    expect(await res.json()).toEqual({ success: false, error: 'NOT_FOUND' })
  })

  it('signs the query: a changed parameter is refused', async () => {
    const request = await signed('GET', route('2030-06-17'))
    const tampered = new Request(request.url.replace('2030-06-17', '2030-06-18'), { headers: request.headers })
    expect((await handle(tampered, SECRET, backend().supabase)).status).toBe(401)
  })

  it('answers 503 with Retry-After when the database fails', async () => {
    const m = backend((op) => (op.table === 'appointments' ? { error: { message: 'down' } } : undefined))
    const res = await handle(await signed('GET', route('2030-06-17')), SECRET, m.supabase)
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('1')
  })
})

describe('calls/end', () => {
  it('closes the call with a known outcome and refuses others', async () => {
    const m = backend()
    const ok = await handle(await signed('POST', '/v1/calls/CA1/end', { outcome: 'booked' }), SECRET, m.supabase)
    expect(await ok.json()).toEqual({ success: true })
    expect(m.opsFor('phone_agent_calls')[0]?.updatePayload).toMatchObject({ outcome: 'booked' })
    const bad = await handle(await signed('POST', '/v1/calls/CA1/end', { outcome: 'whatever' }), SECRET, m.supabase)
    expect(await bad.json()).toEqual({ success: false, error: 'INVALID_ARGS' })
  })
})
