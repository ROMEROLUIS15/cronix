// @vitest-environment node
/**
 * Runs the real Deno `emitBookingEvent` over a fake network, so a broken channel fails here.
 * `__tests__/notifications/emit-booking-event.test.ts` covers the separate Node copy only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const OWNER_PHONE = '584120000000'

interface FakeNetwork {
  ownerPhone: string | null
  existingEvent: boolean
  insertFails: boolean
  rejectedTemplates: string[]
}

interface Call { step: string; body: Record<string, unknown> }

let network: FakeNetwork
let calls: Call[]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function whatsappResponse(body: Record<string, unknown>): Response {
  if (body['type'] === 'template' && network.rejectedTemplates.includes(String(body['template']))) {
    return jsonResponse({ success: false, error: 'template not approved' })
  }
  return jsonResponse({ success: true })
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
  const body = typeof raw === 'string' && raw ? JSON.parse(raw) as Record<string, unknown> : {}

  if (url.includes('/rest/v1/notifications') && method === 'GET') {
    return jsonResponse(network.existingEvent ? [{ id: 'existing' }] : [])
  }
  if (url.includes('/rest/v1/notifications')) {
    calls.push({ step: 'bell', body })
    return network.insertFails ? jsonResponse({ message: 'insert failed' }, 500) : jsonResponse(null, 201)
  }
  if (url.includes('/rest/v1/businesses')) {
    return jsonResponse([{ phone: network.ownerPhone }])
  }
  if (url.includes('/realtime/v1/api/broadcast')) {
    calls.push({ step: 'realtime', body })
    return jsonResponse({}, 202)
  }
  if (url.includes('/functions/v1/whatsapp-service')) {
    calls.push({ step: 'whatsapp', body })
    return whatsappResponse(body)
  }
  if (url.includes('/functions/v1/push-notify')) {
    calls.push({ step: 'push', body })
    return jsonResponse({ success: true })
  }
  throw new Error(`Unexpected request: ${method} ${url}`)
}

const steps = () => calls.map((c) => c.step)
const whatsappCalls = () => calls.filter((c) => c.step === 'whatsapp').map((c) => c.body)

function eventOf(type: 'appointment.created' | 'appointment.rescheduled' | 'appointment.cancelled') {
  return {
    eventId: `${type}:biz:appt:2026-11-03:13:00`,
    type,
    businessId: 'biz',
    businessName: 'Studio',
    clientName: 'Ana',
    serviceName: 'Cejas',
    date: '2026-11-03',
    time: '13:00',
    userId: 'whatsapp-agent',
    channel: 'whatsapp' as const,
  }
}

const env: Record<string, string> = {
  SUPABASE_URL: 'http://edge.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  CRON_SECRET: 'cron-secret',
}

describe('emitBookingEvent (Deno) reaches the owner', () => {
  let emitBookingEvent: typeof import('../../supabase/functions/_shared/notifications/emit-booking-event').emitBookingEvent

  beforeAll(async () => {
    vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } })
    vi.stubGlobal('fetch', fakeFetch)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    emitBookingEvent = (await import('../../supabase/functions/_shared/notifications/emit-booking-event')).emitBookingEvent
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    calls = []
    network = { ownerPhone: OWNER_PHONE, existingEvent: false, insertFails: false, rejectedTemplates: [] }
  })

  it.each([
    ['appointment.created', 'Nueva cita'],
    ['appointment.rescheduled', 'Cita reagendada'],
    ['appointment.cancelled', 'Cita cancelada'],
  ] as const)('%s runs the bell, Realtime, owner WhatsApp and push, in order', async (type, title) => {
    await emitBookingEvent(eventOf(type))

    expect(steps()).toEqual(['bell', 'realtime', 'whatsapp', 'push'])
    const [message] = whatsappCalls()
    expect(message).toMatchObject({
      to: OWNER_PHONE,
      type: 'template',
      template: 'owner_event_notification',
      languageCode: 'es',
    })
    const parameters = message?.['parameters'] as string[]
    expect(parameters[0]).toContain(title)
    expect(parameters.slice(1, 3)).toEqual(['Ana', 'Cejas'])
    expect(parameters[3]).toContain('1:00')
  })

  it('uses the approved summary template with the event data when the event template is rejected', async () => {
    network.rejectedTemplates = ['owner_event_notification']

    await emitBookingEvent(eventOf('appointment.rescheduled'))

    expect(whatsappCalls().map((m) => m['template'])).toEqual(['owner_event_notification', 'daily_owner_summary'])
    const summary = whatsappCalls()[1]
    expect(summary).toMatchObject({ to: OWNER_PHONE, type: 'template', languageCode: 'es' })
    const [title, details] = summary?.['parameters'] as [string, string]
    expect(title).toBe('Cita reagendada')
    expect(details).toContain('Ana · Cejas · ')
    expect(details).toContain('1:00')
    expect(summary?.['parameters']).toHaveLength(2)
    expect(steps().at(-1)).toBe('push')
  })

  it('keeps the date the client asked for in the summary details', async () => {
    network.rejectedTemplates = ['owner_event_notification']

    await emitBookingEvent({ ...eventOf('appointment.rescheduled'), type: 'appointment.reschedule_requested', requestedDate: '2026-11-10' })

    const [title, details] = whatsappCalls()[1]?.['parameters'] as [string, string]
    expect(title).toBe('Pidió reagendar (pendiente)')
    expect(details).toContain('quiere el')
    expect(details).toContain('10')
  })

  it('falls back to free text only when both templates are rejected', async () => {
    network.rejectedTemplates = ['owner_event_notification', 'daily_owner_summary']

    await emitBookingEvent(eventOf('appointment.rescheduled'))

    expect(whatsappCalls().map((m) => m['type'])).toEqual(['template', 'template', 'text'])
    expect(whatsappCalls()[2]).toMatchObject({ to: OWNER_PHONE })
    expect(steps().at(-1)).toBe('push')
  })

  it('does not send the summary template once the event template is accepted', async () => {
    await emitBookingEvent(eventOf('appointment.created'))

    expect(whatsappCalls().map((m) => m['template'])).toEqual(['owner_event_notification'])
  })

  it('sends nothing for an event that already has a notification', async () => {
    network.existingEvent = true

    await emitBookingEvent(eventOf('appointment.rescheduled'))

    expect(steps()).toEqual([])
  })

  it('skips WhatsApp but keeps the bell and push when the business has no owner phone', async () => {
    network.ownerPhone = null

    await emitBookingEvent(eventOf('appointment.cancelled'))

    expect(steps()).toEqual(['bell', 'realtime', 'push'])
  })

  it('stops after a failed bell insert: the database is the source of truth', async () => {
    network.insertFails = true

    await emitBookingEvent(eventOf('appointment.created'))

    expect(steps()).toEqual(['bell'])
  })
})
