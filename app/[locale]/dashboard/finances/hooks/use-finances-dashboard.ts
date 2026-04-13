/**
 * use-finances-dashboard — Extracts data loading for the finance dashboard.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { calculateMonthlySummary, type FinanceMonthlySummary } from '@/lib/use-cases/finances.use-case';
import type { TransactionRow, ExpenseRow } from '@/types';

export type FinanceSummary = FinanceMonthlySummary;

export interface UseFinancesDashboardReturn {
  summary: FinanceSummary;
  recentTransactions: TransactionRow[];
  recentExpenses: ExpenseRow[];
  loading: boolean;
  fetchError: string | null;
  marginPct: number;
  expensePct: number;
}

const RECENT_ITEMS_LIMIT = 5;

export function useFinancesDashboard(): UseFinancesDashboardReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [summary, setSummary] = useState<FinanceMonthlySummary>({ totalRevenue: 0, totalExpenses: 0, netProfit: 0, marginPct: 0, expensePct: 0 });
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

      const { monthTransactions, monthExpenses, summary } = calculateMonthlySummary(
        txnsRes.data ?? [],
        expsRes.data ?? [],
      );

      setRecentTransactions(monthTransactions.slice(0, RECENT_ITEMS_LIMIT) as TransactionRow[]);
      setRecentExpenses(monthExpenses.slice(0, RECENT_ITEMS_LIMIT) as ExpenseRow[]);
      setSummary(summary);
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

  return {
    summary,
    recentTransactions,
    recentExpenses,
    loading,
    fetchError,
    marginPct:  summary.marginPct,
    expensePct: summary.expensePct,
  };
}
