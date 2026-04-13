/**
 * use-new-transaction-form — Extracts form state and creation logic for the
 * new transaction (income) page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { getBrowserContainer } from '@/lib/browser-container';
import type { PaymentMethod, Client } from '@/types';

export interface NewTransactionForm {
  client_id: string;
  amount: string;
  method: PaymentMethod;
  notes: string;
  date: string;
}

export interface UseNewTransactionFormReturn {
  form: NewTransactionForm;
  setForm: React.Dispatch<React.SetStateAction<NewTransactionForm>>;
  clients: Client[];
  loadingData: boolean;
  saving: boolean;
  msg: { type: 'success' | 'error'; text: string } | null;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

export function useNewTransactionForm(): UseNewTransactionFormReturn {
  const router = useRouter();
  const { businessId, loading: contextLoading } = useBusinessContext();

  const [form, setForm] = useState<NewTransactionForm>({
    client_id: '',
    amount: '',
    method: 'cash' as PaymentMethod,
    notes: '',
    date: new Date().toISOString().split('T')[0] as string,
  });

  const [clients, setClients] = useState<Client[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false);
      return;
    }

    async function loadClients() {
      const container = getBrowserContainer();
      const res = await container.clients.getAll(businessId!);
      setClients(res.error ? [] : res.data as Client[]);
      setLoadingData(false);
    }
    loadClients();
  }, [businessId, contextLoading]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !form.client_id) {
      setMsg({ type: 'error', text: 'Cliente requerido' });
      return;
    }

    setSaving(true);
    const amount = parseFloat(form.amount);

    const container = getBrowserContainer();
    const result = await container.finances.createTransaction({
      business_id: businessId!,
      client_id: form.client_id,
      amount,
      net_amount: amount,
      method: form.method,
      notes: form.notes.trim() || null,
      paid_at: form.date ? new Date(form.date).toISOString() : new Date().toISOString(),
    });

    setSaving(false);
    if (result.error) {
      setMsg({ type: 'error', text: 'Error al guardar el cobro' });
    } else {
      router.push('/dashboard/finances');
      router.refresh();
    }
  }, [businessId, form, router]);

  return { form, setForm, clients, loadingData, saving, msg, handleSubmit };
}
