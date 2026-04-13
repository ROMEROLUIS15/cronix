/**
 * use-finances-dashboard — Extracts data loading for the finance dashboard.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import type { TransactionRow, ExpenseRow } from '@/types';

export interface FinanceSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export interface UseFinancesDashboardReturn {
  summary: FinanceSummary;
  recentTransactions: TransactionRow[];
  recentExpenses: ExpenseRow[];
  loading: boolean;
  fetchError: string | null;
  marginPct: number;
  expensePct: number;
}

export function useFinancesDashboard(): UseFinancesDashboardReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [summary, setSummary] = useState<FinanceSummary>({ totalRevenue: 0, totalExpenses: 0, netProfit: 0 });
  const [recentTransactions, setRecentTransactions] = useState<TransactionRow[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!businessId) return;

    try {
      const container = getBrowserContainer();

      const [txnsRes, expsRes] = await Promise.all([
        container.finances.getTransactions(businessId),
        container.finances.getExpenses(businessId),
      ]);

      if (txnsRes.error) throw new Error(txnsRes.error);
      if (expsRes.error) throw new Error(expsRes.error);

      const txns = txnsRes.data ?? [];
      const exps = expsRes.data ?? [];

      // Filter to current month
      const startOfMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      ).toISOString();

      const monthTxns = txns.filter(t => (t.paid_at ?? '') >= startOfMonth);
      const monthExps = exps.filter(e => (e.expense_date ?? '') >= startOfMonth);

      const totalRevenue = monthTxns.reduce((acc, t) => acc + (t.net_amount ?? 0), 0);
      const totalExpenses = monthExps.reduce((acc, e) => acc + (e.amount ?? 0), 0);

      setRecentTransactions(monthTxns.slice(0, 5));
      setRecentExpenses(monthExps.slice(0, 5));
      setSummary({ totalRevenue, totalExpenses, netProfit: totalRevenue - totalExpenses });
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (businessId) {
      loadData();
    } else if (!contextLoading) {
      setLoading(false);
    }
  }, [businessId, contextLoading, loadData]);

  const marginPct = useMemo(() =>
    summary.totalRevenue > 0
      ? Math.round((summary.netProfit / summary.totalRevenue) * 100)
      : 0
  , [summary.totalRevenue, summary.netProfit]);

  const expensePct = useMemo(() =>
    summary.totalRevenue > 0
      ? Math.min((summary.totalExpenses / summary.totalRevenue) * 100, 100)
      : 0
  , [summary.totalRevenue, summary.totalExpenses]);

  return {
    summary,
    recentTransactions,
    recentExpenses,
    loading,
    fetchError,
    marginPct,
    expensePct,
  };
}
