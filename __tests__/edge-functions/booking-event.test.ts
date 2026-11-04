// @vitest-environment node
/**
 * The single entry the dashboard forms use to reach emitBookingEvent. The event is built on the
 * server from the caller's own business: nothing about the appointment is taken from the browser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleBookingEvent, type BookingEventDeps } from '../../supabase/functions/booking-event/handler'

const APPOINTMENT = 'a1111111-1111-4111-8111-111111111111'
const BUSINESS = { id: 'biz-1', name: 'Studio', timezone: 'America/Caracas' }

const ROW = {
  id: APPOINTMENT,
  start_at: '2026-11-06T19:00:00.000Z', // 15:00 in Caracas
  client_name: 'Ana Pérez',
  service_names: ['Cejas', 'Pestañas'],
}

function request(body: unknown, token: string | null = 'jwt'): Request {
  return new Request('http://edge.test/booking-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

let deps: BookingEventDeps & { emit: ReturnType<typeof vi.fn>; findAppointment: ReturnType<typeof vi.fn> }

beforeEach(() => {
  deps = {
    findActor: vi.fn(async (jwt: string) => (jwt === 'jwt' ? { userId: 'user-1', role: 'owner', business: BUSINESS } : null)),
    findAppointment: vi.fn(async () => ROW),
    emit: vi.fn(async () => undefined),
  } as typeof deps
})

describe('booking-event', () => {
  it.each([
    ['created', 'appointment.created'],
    ['rescheduled', 'appointment.rescheduled'],
    ['cancelled', 'appointment.cancelled'],
  ] as const)('%s reaches the shared pipeline with the data read on the server', async (action, type) => {
    const res = await handleBookingEvent(request({ action, appointmentId: APPOINTMENT }), deps)

    expect(res.status).toBe(200)
    expect(deps.emit).toHaveBeenCalledTimes(1)
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({
      type,
      eventId: `${action}:biz-1:${APPOINTMENT}:2026-11-06:15:00`,
      businessId: 'biz-1',
      businessName: 'Studio',
      clientName: 'Ana Pérez',
      serviceName: 'Cejas, Pestañas',
      date: '2026-11-06',
      time: '15:00',
      userId: 'user-1',
      channel: 'dashboard',
    }))
  })

  it.each([
    ['owner', true],
    ['platform_admin', true],
    ['employee', false],
  ])('a %s acting sets ownerActed=%s, so only employees alert the owner by WhatsApp', async (role, ownerActed) => {
    deps.findActor = vi.fn(async () => ({ userId: 'user-1', role, business: BUSINESS }))

    await handleBookingEvent(request({ action: 'rescheduled', appointmentId: APPOINTMENT }), deps)

    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ ownerActed }))
  })

  it('looks the appointment up only inside the business of the caller', async () => {
    await handleBookingEvent(request({ action: 'cancelled', appointmentId: APPOINTMENT }), deps)

    expect(deps.findAppointment).toHaveBeenCalledWith(APPOINTMENT, 'biz-1')
  })

  it('answers 404 and notifies nobody for an appointment of another business', async () => {
    deps.findAppointment.mockResolvedValue(null)

    const res = await handleBookingEvent(request({ action: 'cancelled', appointmentId: APPOINTMENT }), deps)

    expect(res.status).toBe(404)
    expect(deps.emit).not.toHaveBeenCalled()
  })

  it.each([
    ['no token', null],
    ['an invalid token', 'bad'],
  ])('answers 401 with %s', async (_label, token) => {
    const res = await handleBookingEvent(request({ action: 'created', appointmentId: APPOINTMENT }, token), deps)

    expect(res.status).toBe(401)
    expect(deps.emit).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown action', { action: 'deleted', appointmentId: APPOINTMENT }],
    ['an id that is not a UUID', { action: 'created', appointmentId: 'x' }],
    ['no id', { action: 'created' }],
  ])('answers 400 for %s', async (_label, body) => {
    const res = await handleBookingEvent(request(body), deps)

    expect(res.status).toBe(400)
    expect(deps.emit).not.toHaveBeenCalled()
  })

  it('answers 400 when the body is not JSON', async () => {
    const res = await handleBookingEvent(new Request('http://edge.test/', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: 'nope' }), deps)

    expect(res.status).toBe(400)
  })

  it('answers the browser preflight without authentication', async () => {
    const res = await handleBookingEvent(new Request('http://edge.test/', { method: 'OPTIONS' }), deps)

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('still answers 200 when the pipeline throws: the appointment is already saved', async () => {
    deps.emit.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)

    const res = await handleBookingEvent(request({ action: 'created', appointmentId: APPOINTMENT }), deps)

    expect(res.status).toBe(200)
  })
})
