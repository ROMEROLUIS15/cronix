/**
 * use-appointments-list — Extracts data loading and status resolution
 * from the appointments list page into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { isExpiredAppointment } from '@/lib/use-cases/appointments.use-case';
import { completeAppointment } from '@/lib/actions/complete-appointment';
import type { AppointmentWithRelations, AppointmentStatus } from '@/types';
import { format } from 'date-fns';
import { REALTIME_REFRESH_EVENT } from '@/lib/realtime/announce-appointment-change';

export type ViewMode = 'day' | 'week';

/** Same safety net as the home calendar: a missed broadcast shows up within this time. */
const REFRESH_INTERVAL_MS = 20_000;

export interface UseAppointmentsListReturn {
  appointments: AppointmentWithRelations[];
  filteredApts: AppointmentWithRelations[];
  loading: boolean;
  resolvingId: string | null;
  view: ViewMode;
  setView: React.Dispatch<React.SetStateAction<ViewMode>>;
  date: Date;
  setDate: React.Dispatch<React.SetStateAction<Date>>;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  handlePrevDay: () => void;
  handleNextDay: () => void;
  handleResolve: (aptId: string, resolution: 'completed' | 'no_show') => Promise<void>;
  isExpired: (apt: AppointmentWithRelations) => boolean;
}

export function useAppointmentsList(): UseAppointmentsListReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [appointments, setAppointments] = useState<AppointmentWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('day');
  const [date, setDate] = useState(new Date());
  const [query, setQuery] = useState('');

  const latestRequest = useRef(0);

  // A background refresh keeps the current list on screen: no spinner, and a failure leaves it as is.
  const fetchAppointments = useCallback(async ({ background = false } = {}) => {
    if (!businessId) return;
    const request = ++latestRequest.current;
    if (!background) setLoading(true);
    const dateStr = format(date, 'yyyy-MM-dd');

    try {
      const container = getBrowserContainer();
      const result = await container.appointments.getDayAppointments(businessId, dateStr);
      if (request !== latestRequest.current) return;
      if (!result.error) setAppointments(result.data ?? []);
      else if (!background) setAppointments([]);
    } catch {
      if (request === latestRequest.current && !background) setAppointments([]);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [businessId, date]);

  useEffect(() => {
    if (!contextLoading) {
      fetchAppointments();
    }
  }, [fetchAppointments, contextLoading]);

  // Auto-refresh when any appointment changes: at once on the layout listener's event, and by
  // polling and on returning to the tab for what a sleeping device or a lost broadcast misses.
  useEffect(() => {
    if (!businessId) return;
    const refresh = () => void fetchAppointments({ background: true });
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const poll = window.setInterval(refreshIfVisible, REFRESH_INTERVAL_MS);
    window.addEventListener(REALTIME_REFRESH_EVENT, refresh);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener(REALTIME_REFRESH_EVENT, refresh);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [businessId, fetchAppointments]);

  const filteredApts = useMemo(
    () => appointments.filter(a =>
      a.status !== 'cancelled' &&
      (a.client?.name?.toLowerCase().includes(query.toLowerCase()) ||
       a.service?.name?.toLowerCase().includes(query.toLowerCase()))
    ),
    [appointments, query]
  );

  const handlePrevDay = useCallback(() => setDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n }), []);
  const handleNextDay = useCallback(() => setDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n }), []);

  const handleResolve = useCallback(async (
    aptId: string,
    resolution: 'completed' | 'no_show'
  ) => {
    if (!businessId) return;
    setResolvingId(aptId);
    try {
      // 'completed' triggers auto-billing via CompleteAppointmentUseCase.
      // 'no_show' is a plain status update — no billing involved.
      if (resolution === 'completed') {
        const result = await completeAppointment(aptId, businessId);
        if (result.error) throw new Error(result.error)
      } else {
        const container = getBrowserContainer();
        const result = await container.appointments.updateStatus(aptId, resolution, businessId);
        if (result.error) throw new Error(result.error)
      }
      setAppointments(prev =>
        prev.map(a => a.id === aptId ? { ...a, status: resolution } : a)
      );
    } catch {
      // Silently fail — state remains unchanged
    } finally {
      setResolvingId(null);
    }
  }, [businessId]);

  const isExpired = useCallback((apt: AppointmentWithRelations) =>
    isExpiredAppointment({
      end_at: apt.end_at,
      status: apt.status ?? 'pending',
    }),
    []
  );

  return {
    appointments,
    filteredApts,
    loading: loading || contextLoading,
    resolvingId,
    view,
    setView,
    date,
    setDate,
    query,
    setQuery,
    handlePrevDay,
    handleNextDay,
    handleResolve,
    isExpired,
  };
}
