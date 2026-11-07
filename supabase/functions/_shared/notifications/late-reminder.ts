/**
 * late-reminder.ts — Asks cron-reminders for the client's WhatsApp reminder when an
 * appointment is booked or moved, so one booked after that night's 20:00 run still gets it.
 *
 * cron-reminders decides whether it is late (tomorrow, and 19:55 or later in the
 * business timezone) and sends it with the nightly run's own sender; this only forwards
 * the appointment. The WhatsApp agent is left out: the client just got the confirmation
 * in that chat, and operacion-canonica C1 allows exactly one.
 *
 * Runs in the background when the edge runtime allows it, so the dashboard and the voice
 * button do not wait for the reminder. Never throws: the booking is already committed.
 */

import { captureException } from "../sentry.ts"
import type { AppointmentEvent } from "./notif-contracts.ts"

const REMINDED_TYPES: ReadonlySet<AppointmentEvent['type']> = new Set(['appointment.created', 'appointment.rescheduled'])

type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }

export function wantsLateReminder(event: AppointmentEvent): boolean {
  return !!event.appointmentId && event.channel !== 'whatsapp' && REMINDED_TYPES.has(event.type)
}

async function postLateReminder(event: AppointmentEvent): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const secret = Deno.env.get('CRON_SECRET')
  const context = { stage: 'late_reminder_request', business_id: event.businessId }
  if (!url || !secret) {
    captureException(new Error('late reminder: SUPABASE_URL or CRON_SECRET is not set'), context)
    return
  }
  try {
    const res = await fetch(`${url}/functions/v1/cron-reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
      body: JSON.stringify({
        lateReminder: {
          businessId: event.businessId,
          appointmentId: event.appointmentId,
          rescheduled: event.type === 'appointment.rescheduled',
        },
      }),
    })
    if (!res.ok) captureException(new Error(`late reminder: cron-reminders answered ${res.status}`), context)
  } catch (err) {
    captureException(err, context)
  }
}

export async function requestLateReminder(event: AppointmentEvent): Promise<void> {
  if (!wantsLateReminder(event)) return
  const work = postLateReminder(event)
  const runtime = (globalThis as EdgeRuntimeGlobal).EdgeRuntime
  if (runtime) runtime.waitUntil(work)
  else await work
}
