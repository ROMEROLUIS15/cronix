/**
 * booking-event — The dashboard's way into the shared booking pipeline (emitBookingEvent).
 *
 * The browser cannot import Deno code, so after writing an appointment the forms call this.
 * JWT-gated by Supabase (verify_jwt), and the handler resolves the caller's business again.
 */

import { getAdminClient } from '../_shared/supabase.ts'
import { emitBookingEvent } from '../_shared/notifications/emit-booking-event.ts'
import { handleBookingEvent, type Actor, type AppointmentRow } from './handler.ts'

const db = getAdminClient()

async function findActor(jwt: string): Promise<Actor | null> {
  const { data: auth, error: authError } = await db.auth.getUser(jwt)
  if (authError || !auth.user) return null

  const { data: profile, error } = await db
    .from('users')
    .select('id, role, business:businesses(id, name, timezone)')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (error || !profile) return null

  const business = profile.business as unknown as Actor['business'] | null
  if (!business) return null
  return { userId: profile.id as string, role: (profile.role as string | null) ?? 'employee', business }
}

interface ServiceRef { name: string | null }

async function findAppointment(appointmentId: string, businessId: string): Promise<AppointmentRow | null> {
  const { data, error } = await db
    .from('appointments')
    .select('id, start_at, client:clients(name), service:services(name), appointment_services(sort_order, service:services(name))')
    .eq('id', appointmentId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (error || !data) return null

  const junction = (data.appointment_services as unknown as Array<{ sort_order: number; service: ServiceRef | null }> | null) ?? []
  const names = [...junction].sort((a, b) => a.sort_order - b.sort_order).map((s) => s.service?.name).filter(Boolean) as string[]
  const fallback = (data.service as unknown as ServiceRef | null)?.name
  return {
    id:            data.id as string,
    start_at:      data.start_at as string,
    client_name:   (data.client as unknown as { name: string | null } | null)?.name ?? 'Cliente',
    service_names: names.length ? names : [fallback ?? 'Servicio'],
  }
}

Deno.serve((req) => handleBookingEvent(req, { findActor, findAppointment, emit: emitBookingEvent }))
