import type { SupabaseClient } from '@supabase/supabase-js'

/** The broadcast event the dashboard screens refresh on after a web write to appointments. */
export const APPOINTMENT_CHANGED = 'appointment.changed'

/**
 * announceAppointmentChange — tells every open dashboard of the business that its appointments
 * changed, over Realtime Broadcast sent by REST (no WebSocket needed).
 *
 * It replaces postgres_changes, which made Realtime read the database's WAL all the time and,
 * on the Nano instance, used up the disk IO budget until the database stopped answering
 * (2026-10-29). The WhatsApp and voice agents already announce their writes on this same channel.
 *
 * `supabase.channel(topic)` returns the channel already open for that topic, if any (the
 * dashboard keeps `notifications:<business>` subscribed): it is removed afterwards only when
 * this call created it. Never throws: a missed broadcast only delays the refresh until the
 * screens' own polling.
 */
export async function announceAppointmentChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  businessId: string,
): Promise<void> {
  const topic = `notifications:${businessId}`
  try {
    const existed = supabase.getChannels().some((c) => c.topic === `realtime:${topic}`)
    const channel = supabase.channel(topic)
    await channel.httpSend(APPOINTMENT_CHANGED, {})
    if (!existed) await supabase.removeChannel(channel)
  } catch {
    // Non-critical: the screens poll as a safety net.
  }
}
