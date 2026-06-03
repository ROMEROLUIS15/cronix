/**
 * Bell notification dispatch.
 *
 * Inserts a row into `public.notifications`. The frontend FAB subscribes to
 * postgres_changes on this table via Supabase Realtime, so the bell badge
 * updates automatically — no explicit broadcast needed here.
 *
 * Idempotency: the `event_id` column has a UNIQUE constraint (or we check
 * existence first). Same eventId → same notification → no duplicate.
 *
 * Fire-and-forget: notifications are derivative; never block the response.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppointmentNotification, NotificationType } from './types.ts'

function buildTitle(type: NotificationType): string {
  switch (type) {
    case 'appointment.created':     return 'Nueva cita agendada'
    case 'appointment.rescheduled': return 'Cita reagendada'
    case 'appointment.cancelled':   return 'Cita cancelada'
  }
}

function buildContent(n: AppointmentNotification): string {
  const base = `${n.clientName} — ${n.serviceName} el ${n.date} a las ${n.time}`
  switch (n.type) {
    case 'appointment.created':     return `Nueva cita: ${base}`
    case 'appointment.rescheduled': return `Reagendada: ${base}`
    case 'appointment.cancelled':   return `Cancelada: ${base}`
  }
}

/**
 * Inserts a notification row. Idempotent via event_id check.
 * Returns void — failures are logged but never propagate.
 */
export async function dispatchBellNotification(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  notif:    AppointmentNotification,
): Promise<void> {
  try {
    // Idempotency: skip if event already saved
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('event_id', notif.eventId)
      .maybeSingle()

    if (existing) {
      console.log(`[VOICE-WORKER-NOTIF] Event ${notif.eventId} already saved — skipping`)
      return
    }

    const { error } = await supabase
      .from('notifications')
      .insert({
        business_id: notif.businessId,
        title:       buildTitle(notif.type),
        content:     buildContent(notif),
        type:        notif.type === 'appointment.cancelled' ? 'warning' : 'success',
        is_read:     false,
        event_id:    notif.eventId,
        metadata: {
          eventType:   notif.type,
          clientName:  notif.clientName,
          serviceName: notif.serviceName,
          date:        notif.date,
          time:        notif.time,
          channel:     'web',
          userId:      notif.userId,
        },
      })

    if (error) {
      console.warn(`[VOICE-WORKER-NOTIF] Insert failed: ${error.message}`)
    }
  } catch (err) {
    console.warn(`[VOICE-WORKER-NOTIF] Dispatch threw: ${err instanceof Error ? err.message : String(err)}`)
  }
}
