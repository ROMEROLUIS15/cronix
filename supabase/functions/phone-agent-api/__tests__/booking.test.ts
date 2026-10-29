/**
 * phone-agent-api booking — the time checked against the shared resolver, one booking per
 * idempotency key, and the owner notified only when it booked.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMockSupabase, type CapturedOp, type MockResponse } from '../../_shared/__tests__/_mock-supabase.ts'
import { hmacSha256Hex } from '../../_shared/hmac.ts'
import type { AppointmentEvent } from '../../_shared/notifications/notif-contracts.ts'

vi.mock('../../_shared/sentry.ts', () => ({ initSentry: () => {}, captureException: () => {} }))
vi.mock('../../_shared/supabase.ts', () => ({ getAdminClient: () => ({}) }))
vi.mock('../../_shared/notifications/emit-booking-event.ts', () => ({ emitBookingEvent: async () => {} }))

const { handle } = await import('../index.ts')

const SECRET = 'test-signing-secret'
const BIZ = 'b0000000-0000-0000-0000-000000000001'
const KEY = 'proposal-1'
// A Monday open 09:00–12:00; the service lasts 60 minutes.
const BODY = { call_sid: 'CA1', service_id: 's1', date: '2030-06-17', time: '10:00', client_name: 'Ana Ejemplo' }

async function request(body: object, key: string | null = KEY): Promise<Request> {
  const raw = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await hmacSha256Hex(SECRET, `${timestamp}.POST./v1/appointments.${raw}`)
  const headers: Record<string, string> = { 'x-cronix-timestamp': timestamp, 'x-cronix-signature': signature }
  if (key) headers['idempotency-key'] = key
  return new Request('http://localhost/functions/v1/phone-agent-api/v1/appointments', { method: 'POST', headers, body: raw })
}

function backend(overrides: (op: CapturedOp) => MockResponse | undefined = () => undefined) {
  return createMockSupabase((op) => {
    const custom = overrides(op)
    if (custom) return custom
    if (op.table === 'phone_agent_calls' && op.selectArg === 'caller_phone') return { data: { caller_phone: '+584120000001' } }
    if (op.table === 'phone_agent_calls') return { data: { business_id: BIZ } }
    if (op.table === 'businesses' && op.selectArg === 'name') return { data: { name: 'Barbería Prueba' } }
    if (op.table === 'businesses') return { data: { timezone: 'America/Caracas', settings: { workingHours: { mon: ['09:00', '12:00'] } } } }
    if (op.table === 'services') return { data: { name: 'Corte', duration_min: 60 } }
    if (op.table === 'appointments') return { data: [] }
    if (op.table === 'phone_agent_requests' && op.type === 'upsert') return { data: [{ request_hash: 'claimed' }] }
    if (op.table === 'rpc:fn_book_appointment_wa') return { data: { success: true, appointment_id: 'a1' } }
    return { data: null }
  })
}

async function run(m: ReturnType<typeof backend>, req: Request) {
  const notified: AppointmentEvent[] = []
  const res = await handle(req, SECRET, m.supabase, async (event) => { notified.push(event) })
  return { status: res.status, body: await res.json(), notified }
}

describe('booking', () => {
  it('books with the caller number through the WhatsApp booking function and notifies the owner as a phone booking', async () => {
    const m = backend()
    const { status, body, notified } = await run(m, await request(BODY))
    expect([status, body]).toEqual([200, { success: true, appointment_id: 'a1' }])
    const [rpc] = m.opsFor('rpc:fn_book_appointment_wa')
    expect(rpc?.insertPayload).toMatchObject({ p_business_id: BIZ, p_client_phone: '+584120000001', p_client_name: 'Ana Ejemplo', p_service_id: 's1' })
    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({ type: 'appointment.created', channel: 'phone', userId: 'phone-agent', date: '2030-06-17', time: '10:00' })
    expect(m.opsFor('phone_agent_requests').find((o) => o.type === 'update')?.updatePayload).toEqual({ response: { success: true, appointment_id: 'a1' } })
    expect(m.opsFor('services')[0]?.eq).toContainEqual(['business_id', BIZ])
  })

  it('answers OUTSIDE_HOURS when the service would end after closing, and books nothing', async () => {
    const m = backend()
    const { body, notified } = await run(m, await request({ ...BODY, time: '11:30' }))
    expect(body).toEqual({ success: false, error: 'OUTSIDE_HOURS' })
    expect(m.opsFor('rpc:fn_book_appointment_wa')).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })

  it('answers SLOT_CONFLICT for a taken time within the hours, and when the booking function finds one', async () => {
    const taken = backend((op) => (op.table === 'appointments'
      ? { data: [{ start_at: '2030-06-17T14:00:00.000Z', end_at: '2030-06-17T15:00:00.000Z' }] } // 10:00–11:00 Caracas
      : undefined))
    expect((await run(taken, await request(BODY))).body).toEqual({ success: false, error: 'SLOT_CONFLICT' })
    expect(taken.opsFor('rpc:fn_book_appointment_wa')).toHaveLength(0)

    const raced = backend((op) => (op.table === 'rpc:fn_book_appointment_wa' ? { data: { success: false, error: 'SLOT_CONFLICT' } } : undefined))
    const { body, notified } = await run(raced, await request(BODY))
    expect(body).toEqual({ success: false, error: 'SLOT_CONFLICT' })
    expect(notified).toHaveLength(0)
  })

  it('returns the stored response for the same key without booking again, and 409 for another body', async () => {
    const hash = await hmacSha256Hex('phone-agent-request', JSON.stringify(BODY))
    const prior = (response: unknown, requestHash = hash) => backend((op) => {
      if (op.table === 'phone_agent_requests' && op.type === 'upsert') return { data: [] } // already claimed
      if (op.table === 'phone_agent_requests') return { data: { request_hash: requestHash, response } }
      return undefined
    })
    const replayed = prior({ success: true, appointment_id: 'a1' })
    const again = await run(replayed, await request(BODY))
    expect([again.status, again.body, again.notified]).toEqual([200, { success: true, appointment_id: 'a1' }, []])
    expect(replayed.opsFor('rpc:fn_book_appointment_wa')).toHaveLength(0)

    const other = await run(prior({ success: true }, 'another-hash'), await request(BODY))
    expect([other.status, other.body]).toEqual([409, { success: false, error: 'IDEMPOTENCY_MISMATCH' }])

    const inProgress = await run(prior(null), await request(BODY))
    expect(inProgress.status).toBe(503)
  })

  it('refuses a booking without an idempotency key or with a bad time', async () => {
    expect((await run(backend(), await request(BODY, null))).body).toEqual({ success: false, error: 'INVALID_ARGS' })
    expect((await run(backend(), await request({ ...BODY, time: '25:00' }))).body).toEqual({ success: false, error: 'INVALID_ARGS' })
  })
})
