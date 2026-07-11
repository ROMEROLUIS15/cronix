'use client'

import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'

/**
 * useRealtimeDashboardSync — invalidates React Query caches when the DB changes.
 *
 * Any write by the AI assistant (or by another tab/device) refreshes the calendar,
 * stats and bell without F5. We use TWO mechanisms so a single misconfigured layer
 * never leaves the dashboard stale:
 *   1. postgres_changes — fires for dashboard/web writes.
 *   2. broadcast on `notifications:${businessId}` — emitted by the WhatsApp/voice
 *      edge functions (pushToRealtime). RLS-independent, so it works even when
 *      postgres_changes is dropped by realtime authorization for cross-channel writes.
 *
 * Extracted verbatim from VoiceAssistantFab — behaviour unchanged.
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgChannel = (supabase as any)
      .channel(`cronix-realtime-${businessId}`)
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'appointments', filter: `business_id=eq.${businessId}` }, refreshAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `business_id=eq.${businessId}` }, refreshAll)
      .subscribe()

    // Broadcast bridge: the edge functions send these events on this exact channel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bcChannel = (supabase as any).channel(`notifications:${businessId}`)
    for (const ev of ['appointment.created', 'appointment.rescheduled', 'appointment.cancelled']) {
      bcChannel.on('broadcast', { event: ev }, refreshAll)
    }
    bcChannel.subscribe()

    return () => {
      void supabase.removeChannel(pgChannel)
      void supabase.removeChannel(bcChannel)
    }
  }, [businessId, supabase, queryClient])
}
