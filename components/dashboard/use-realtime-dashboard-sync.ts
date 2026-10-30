'use client'

import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { APPOINTMENT_CHANGED } from '@/lib/realtime/announce-appointment-change'

/**
 * useRealtimeDashboardSync — invalidates React Query caches when the DB changes.
 *
 * Any write by the AI assistant (or by another tab/device) refreshes the calendar,
 * stats and bell without F5, through Broadcast on `notifications:${businessId}`:
 * the WhatsApp/voice edge functions announce their writes there (pushToRealtime),
 * and the web announces its own (announceAppointmentChange).
 *
 * No postgres_changes: it made Realtime read the WAL all the time and, on the Nano
 * instance, used up the disk IO budget until the database stopped answering
 * (2026-10-29). The screens' polling stays as the safety net.
 */
export function useRealtimeDashboardSync(
  businessId: string | null,
  supabase: SupabaseClient,
  queryClient: QueryClient,
): void {
  useEffect(() => {
    if (!businessId) return

    const refreshAll = () => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      // The bell keeps its own state (not React Query) → nudge it via a window event.
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cronix:realtime-refresh'))
    }

    // The edge functions and the web (announceAppointmentChange) send these events on this exact channel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bcChannel = (supabase as any).channel(`notifications:${businessId}`)
    for (const ev of [
      'appointment.created', 'appointment.rescheduled', 'appointment.cancelled',
      // Client requests not confirmed yet (operacion-canonica O3) — refresh the bell now.
      'appointment.reschedule_requested', 'appointment.cancel_requested',
      APPOINTMENT_CHANGED,
    ]) {
      bcChannel.on('broadcast', { event: ev }, refreshAll)
    }
    bcChannel.subscribe()

    return () => {
      void supabase.removeChannel(bcChannel)
    }
  }, [businessId, supabase, queryClient])
}
