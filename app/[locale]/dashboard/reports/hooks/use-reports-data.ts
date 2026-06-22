/**
 * use-reports-data — Extracts data loading for the reports page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import type { ReportData } from '../reports-view';

interface ReportAppointment {
  id: string
  start_at: string
  status: string | null
  service: { name: string; price: number } | null
  client: { name: string } | null
}

export interface UseReportsDataReturn {
  data: ReportData | null;
  loading: boolean;
}

export function useReportsData(): UseReportsDataReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useTranslations('reports');

  const loadReportsData = useCallback(async (bId: string) => {
    try {
      const container = getBrowserContainer();
      const supabase = await createClient();

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
      const monthStartDate = monthStart.split('T')[0] ?? '';

      // Finance figures come from the SAME canonical aggregator Home and Finances
      // use (fn_get_monthly_metrics) — so all three sections reconcile.
      const [aptsRes, clientsRes, metricsRes, businessRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('id, start_at, status, service:services(name, price), client:clients(name)')
          .eq('business_id', bId)
          .gte('start_at', monthStart)
          .lte('start_at', monthEnd)
          .order('start_at', { ascending: false }),
        container.clients.getAll(bId),
        container.finances.getMonthlyMetrics(bId, monthStartDate),
        supabase
          .from('businesses')
          .select('name')
          .eq('id', bId)
          .single(),
      ]);

      const apts = (aptsRes.data ?? []) as ReportAppointment[];
      const activeClients = (clientsRes.data ?? []).filter((c: any) => !c.deleted_at);
      const metrics = metricsRes.data ?? { billed: 0, collected: 0, expenses: 0 };
      const businessName: string | undefined = businessRes.data?.name ?? undefined;

      // Per-service breakdown of BILLED value (list price of completed appts) —
      // the same basis as `metrics.billed`, so the breakdown reconciles with it.
      const byService: Record<string, { count: number; revenue: number }> = {};
      apts.forEach(apt => {
        const name = apt.service?.name ?? t('misc.noService');
        if (!byService[name]) byService[name] = { count: 0, revenue: 0 };
        byService[name].count++;
        if (apt.status === 'completed') byService[name].revenue += apt.service?.price ?? 0;
      });

      const reportData: ReportData = {
        totalAppointments: apts.length,
        completedAppointments: apts.filter(a => a.status === 'completed').length,
        cancelledAppointments: apts.filter(a => a.status === 'cancelled').length,
        totalClients: activeClients.length,
        billed: metrics.billed,
        collected: metrics.collected,
        expenses: metrics.expenses,
        netProfit: metrics.collected - metrics.expenses,
        byService,
        recentAppointments: apts.slice(0, 10),
        businessName,
      };

      setData(reportData);
    } catch {
      // Silently fail — page handles empty state
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (businessId) loadReportsData(businessId);
    else if (!contextLoading) setLoading(false);
  }, [businessId, contextLoading, loadReportsData]);

  return { data, loading };
}
