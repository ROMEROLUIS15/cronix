/**
 * use-expenses-list — Extracts data loading and filtering for the
 * expenses list page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import type { ExpenseRow } from '@/types';

export interface UseExpensesListReturn {
  expenses: ExpenseRow[];
  filtered: ExpenseRow[];
  loading: boolean;
  fetchError: string | null;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
}

export function useExpensesList(): UseExpensesListReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadExpenses = useCallback(async () => {
    if (!businessId) return;

    try {
      const container = getBrowserContainer();
      const result = await container.finances.getExpenses(businessId);

      if (result.error) throw new Error(result.error);

      setExpenses(result.data ?? []);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'No se pudieron cargar los gastos');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (businessId) {
      loadExpenses();
    } else if (!contextLoading) {
      setLoading(false);
    }
  }, [businessId, contextLoading, loadExpenses]);

  const filtered = useMemo(() => {
    const searchTerm = (query || '').toLowerCase();
    return expenses.filter((e) => {
      const description = String(e?.description || '').toLowerCase();
      const category = String(e?.category || '').toLowerCase();
      return description.includes(searchTerm) || category.includes(searchTerm);
    });
  }, [expenses, query]);

  return { expenses, filtered, loading, fetchError, query, setQuery };
}
