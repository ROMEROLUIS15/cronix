/**
 * use-finances-dashboard — Data loading for the finance dashboard.
 *
 * The monthly summary comes from the canonical DB aggregator
 * (fn_get_monthly_metrics via getMonthlyMetrics) — the SAME source Home and
 * Reports use, so the numbers always reconcile. The recent transaction/expense
 * lists are a separate, limited read for display only.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { buildMonthlyFinanceView, type MonthlyFinanceView } from '@/lib/use-cases/finances.use-case';
import type { TransactionRow, ExpenseRow } from '@/types';

export type { MonthlyFinanceView } from '@/lib/use-cases/finances.use-case';

export interface UseFinancesDashboardReturn {
  view: MonthlyFinanceView;
  recentTransactions: TransactionRow[];
  recentExpenses: ExpenseRow[];
  loading: boolean;
  fetchError: string | null;
}

const RECENT_ITEMS_LIMIT = 5;

const EMPTY_VIEW: MonthlyFinanceView = {
  billed: 0, collected: 0, expenses: 0,
  netProfit: 0, marginPct: 0, expensePct: 0, collectionRate: 0,
};

function currentMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0] ?? '';
}

export function useFinancesDashboard(): UseFinancesDashboardReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [view, setView] = useState<MonthlyFinanceView>(EMPTY_VIEW);
  const [recentTransactions, setRecentTransactions] = useState<TransactionRow[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!businessId) return;

    try {
      const container = getBrowserContainer();

      const [metricsRes, txnsRes, expsRes] = await Promise.all([
        container.finances.getMonthlyMetrics(businessId, currentMonthStart()),
        container.finances.getTransactions(businessId, { limit: RECENT_ITEMS_LIMIT }),
        container.finances.getExpenses(businessId),
      ]);

      if (metricsRes.error) throw new Error(metricsRes.error);
      if (txnsRes.error) throw new Error(txnsRes.error);
      if (expsRes.error) throw new Error(expsRes.error);

      setView(buildMonthlyFinanceView(metricsRes.data ?? { billed: 0, collected: 0, expenses: 0 }));
      setRecentTransactions((txnsRes.data ?? []) as TransactionRow[]);
      setRecentExpenses((expsRes.data ?? []).slice(0, RECENT_ITEMS_LIMIT) as ExpenseRow[]);
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

  return { view, recentTransactions, recentExpenses, loading, fetchError };
}
