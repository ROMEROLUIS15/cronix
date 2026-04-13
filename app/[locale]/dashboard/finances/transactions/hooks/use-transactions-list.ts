/**
 * use-transactions-list — Extracts data loading and filtering for the
 * transactions list page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getContainer } from '@/lib/container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import type { TransactionRow } from '@/types';

export interface UseTransactionsListReturn {
  transactions: TransactionRow[];
  filtered: TransactionRow[];
  loading: boolean;
  fetchError: string | null;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
}

export function useTransactionsList(): UseTransactionsListReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadTransactions = useCallback(async () => {
    if (!businessId) return;

    try {
      const container = await getContainer();
      const result = await container.finances.getTransactions(businessId);

      if (result.error) throw new Error(result.error);

      setTransactions(result.data ?? []);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'No se pudieron cargar los cobros');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (businessId) {
      loadTransactions();
    } else if (!contextLoading) {
      setLoading(false);
    }
  }, [businessId, contextLoading, loadTransactions]);

  const filtered = useMemo(() =>
    transactions.filter((t) =>
      (t.notes ?? '').toLowerCase().includes(query.toLowerCase()) ||
      String(t.method || '').toLowerCase().includes(query.toLowerCase())
    )
  , [transactions, query]);

  return { transactions, filtered, loading, fetchError, query, setQuery };
}
