/**
 * use-clients-list — Extracts data loading for the clients list page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Client } from '@/types';
import { getContainer } from '@/lib/container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';

export interface UseClientsListReturn {
  clients: Client[];
  loading: boolean;
}

export function useClientsList(): UseClientsListReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const loadClients = useCallback(async (bId: string) => {
    try {
      const container = await getContainer();
      const result = await container.clients.getAll(bId);
      setClients(result.data ?? []);
    } catch {
      // Silently fail — page handles empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (businessId) loadClients(businessId);
    else if (!contextLoading) setLoading(false);
  }, [businessId, contextLoading, loadClients]);

  return { clients, loading };
}
