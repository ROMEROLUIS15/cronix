/**
 * handler.ts — What the dashboard asks of the shared booking pipeline.
 *
 * The browser only says which appointment changed and how. Everything the owner reads is
 * read here, inside the caller's business, so no one can alert about an appointment of
 * another business or put words in the alert.
 */

import { utcToLocalParts } from '../process-whatsapp/time-utils.ts'
import { buildAppointmentEventId } from '../_shared/notifications/event-id.ts'
import { type AppointmentEvent, isOwnerActor } from '../_shared/notifications/notif-contracts.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_TYPES = {
  created:     'appointment.created',
  rescheduled: 'appointment.rescheduled',
  cancelled:   'appointment.cancelled',
} as const
type Action = keyof typeof EVENT_TYPES

export interface Actor {
  userId:   string
  role:     string
  business: { id: string; name: string; timezone: string }
}

export interface AppointmentRow {
  id:            string
  start_at:      string
  client_name:   string
  service_names: string[]
}

export interface BookingEventDeps {
  findActor(jwt: string): Promise<Actor | null>
  findAppointment(appointmentId: string, businessId: string): Promise<AppointmentRow | null>
  emit(event: AppointmentEvent): Promise<void>
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

async function parseBody(req: Request): Promise<{ action: Action; appointmentId: string } | null> {
  const body = await req.json().catch(() => null) as { action?: unknown; appointmentId?: unknown } | null
  const { action, appointmentId } = body ?? {}
  if (typeof action !== 'string' || !Object.hasOwn(EVENT_TYPES, action)) return null
  if (typeof appointmentId !== 'string' || !UUID.test(appointmentId)) return null
  return { action: action as Action, appointmentId }
}

function buildEvent(action: Action, row: AppointmentRow, actor: Actor): AppointmentEvent {
  const { date, time } = utcToLocalParts(row.start_at, actor.business.timezone)
  return {
    eventId:      buildAppointmentEventId(action, actor.business.id, row.id, date, time),
    type:         EVENT_TYPES[action],
    businessId:   actor.business.id,
    businessName: actor.business.name,
    clientName:   row.client_name,
    serviceName:  row.service_names.join(', '),
    date, time,
    userId:       actor.userId,
    channel:      'dashboard',
    ownerActed:   isOwnerActor(actor.role),
  }
}

export async function handleBookingEvent(req: Request, deps: BookingEventDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const actor = jwt ? await deps.findActor(jwt) : null
  if (!actor) return json(401, { error: 'Unauthorized' })

  const body = await parseBody(req)
  if (!body) return json(400, { error: 'Invalid request' })

  const row = await deps.findAppointment(body.appointmentId, actor.business.id)
  if (!row) return json(404, { error: 'Appointment not found' })

  try {
    await deps.emit(buildEvent(body.action, row, actor))
  } catch (err) {
    // The appointment is already saved: a failed alert must not read as a failed write.
    console.error('[BOOKING-EVENT] emit failed:', err)
  }
  return json(200, { success: true })
}
