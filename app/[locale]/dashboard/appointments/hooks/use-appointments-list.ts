/**
 * use-appointments-list — Extracts data loading and status resolution
 * from the appointments list page into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getContainer } from '@/lib/container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { isExpiredAppointment } from '@/lib/use-cases/appointments.use-case';
import type { AppointmentWithRelations, AppointmentStatus } from '@/types';
import { format } from 'date-fns';

export type ViewMode = 'day' | 'week';

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

  const fetchAppointments = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const dateStr = format(date, 'yyyy-MM-dd');

    try {
      const container = await getContainer();
      const result = await container.appointments.getDayAppointments(businessId, dateStr);
      setAppointments(result.error ? [] : result.data ?? []);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, date]);

  useEffect(() => {
    if (!contextLoading) {
      fetchAppointments();
    }
  }, [fetchAppointments, contextLoading]);

  const filteredApts = useMemo(
    () => appointments.filter(a =>
      a.client?.name?.toLowerCase().includes(query.toLowerCase()) ||
      a.service?.name?.toLowerCase().includes(query.toLowerCase())
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
      const container = await getContainer();
      const result = await container.appointments.updateStatus(aptId, resolution, businessId);
      if (!result.error) {
        setAppointments(prev =>
          prev.map(a => a.id === aptId ? { ...a, status: resolution } : a)
        );
      }
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
